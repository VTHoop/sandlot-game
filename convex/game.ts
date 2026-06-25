import {
  type AppliedAtBat,
  advance,
  type GameContext,
  type GameStatus,
  type Half,
  startGame as initGameState,
  type LiveGameState,
  type TeamLineup,
} from '@sandlot/engine/game'
import { v } from 'convex/values'
import type { Doc, Id } from './_generated/dataModel'
import { type MutationCtx, mutation } from './_generated/server'
import { authedUser, ownsTeam } from './participants'

/**
 * Authoritative game-state mutations (SAN-21). The live `games` row — inning,
 * half, outs, bases, score, whose-turn, status — is advanced ONLY here, never by
 * a client write (game-integrity rule, ADR-0004 / ADR-0017). `startGame` opens a
 * scheduled game; `applyResolvedAtBat` folds each resolved at-bat into the row,
 * called from the secret round-trip's resolution in the SAME transaction as the
 * log append so the two never diverge.
 *
 * The transition math itself lives in the pure `@sandlot/engine/game` module; the
 * helpers below are only the Convex boundary: load lineups, map the `games` Doc
 * to/from the engine's `LiveGameState`, and persist the result.
 */

// ─── Boundary mapping (Convex Doc ↔ engine state) ───────────────────────────

function toTeamLineup(row: Doc<'lineups'>): TeamLineup {
  return { battingOrder: row.battingOrder.map((slot) => slot.player), pitcher: row.pitcher }
}

async function loadContext(ctx: MutationCtx, game: Doc<'games'>): Promise<GameContext> {
  const lineups = await ctx.db
    .query('lineups')
    .withIndex('by_game', (q) => q.eq('game', game._id))
    .collect()
  const home = lineups.find((l) => l.team === game.homeTeam)
  const away = lineups.find((l) => l.team === game.awayTeam)
  if (!home || !away) throw new Error('Both lineups must be set before the game can run')
  if (!home.battingOrder.length || !away.battingOrder.length) {
    throw new Error('Both lineups need a non-empty batting order before the game can run')
  }
  return { home: toTeamLineup(home), away: toTeamLineup(away) }
}

function toLiveState(game: Doc<'games'>): LiveGameState {
  return {
    // Enum values equal the schema literals; the cast relabels, never remaps.
    status: game.status as GameStatus,
    inning: game.inning,
    half: game.half as Half,
    outs: game.outs,
    bases: game.bases,
    homeScore: game.homeScore,
    awayScore: game.awayScore,
    homeBattingIndex: game.homeBattingIndex,
    awayBattingIndex: game.awayBattingIndex,
    currentBatter: game.currentBatter,
    currentPitcher: game.currentPitcher,
    lastResolvedSequence: game.lastResolvedSequence,
  }
}

/** The patch of authoritative fields the engine state produces. Player refs the
 * engine returns always originate from the context lineups (or null), so the
 * cast back to `Id<'players'>` is sound. */
function toGamePatch(state: LiveGameState) {
  return {
    status: state.status,
    inning: state.inning,
    half: state.half,
    outs: state.outs,
    bases: state.bases,
    homeScore: state.homeScore,
    awayScore: state.awayScore,
    homeBattingIndex: state.homeBattingIndex,
    awayBattingIndex: state.awayBattingIndex,
    currentBatter: state.currentBatter as Id<'players'> | null,
    currentPitcher: state.currentPitcher as Id<'players'> | null,
    lastResolvedSequence: state.lastResolvedSequence,
  }
}

// ─── Authoritative transitions ──────────────────────────────────────────────

/**
 * Open a scheduled game (scheduled → live): seed inning 1 / top / 0 outs / empty
 * bases / 0–0 and seat the leadoff batter + designated pitcher from each lineup.
 * Only a participant (home or away team owner) may start it, and only while it is
 * still 'scheduled'.
 */
export const startGame = mutation({
  args: { game: v.id('games') },
  handler: async (ctx, args): Promise<void> => {
    const game = await ctx.db.get(args.game)
    if (!game) throw new Error('Game not found')
    if (game.status !== 'scheduled') throw new Error('Game is not scheduled')

    const user = await authedUser(ctx)
    const isParticipant =
      (await ownsTeam(ctx, game.homeTeam, user)) || (await ownsTeam(ctx, game.awayTeam, user))
    if (!isParticipant) throw new Error('Not authorized for this game')

    const context = await loadContext(ctx, game)
    await ctx.db.patch(game._id, toGamePatch(initGameState(context)))
  },
})

/**
 * Fold a resolved at-bat into the authoritative live `games` row. Called from the
 * secret round-trip's resolution within the same transaction as the `atBats`
 * append (ADR-0004). Not a client-callable mutation — the engine transition is
 * idempotent per at-bat and rejects a non-live or out-of-order at-bat.
 */
export async function applyResolvedAtBat(
  ctx: MutationCtx,
  game: Doc<'games'>,
  atBat: AppliedAtBat,
): Promise<void> {
  const context = await loadContext(ctx, game)
  const next = advance(toLiveState(game), atBat, context)
  await ctx.db.patch(game._id, toGamePatch(next))
}
