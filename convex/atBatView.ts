import type { GroundBallResult } from '@sandlot/engine/atBat'
import { Half } from '@sandlot/engine/game'
import { isHitBand } from '@sandlot/engine/outcomes'
import { v } from 'convex/values'
import type { Doc, Id } from './_generated/dataModel'
import { query } from './_generated/server'
import type { ResolvedAtBatView } from './duelContract'
import { type Ctx, maybeUser, ownsTeam } from './participants'

/**
 * The resolved at-bat read model (SAN-39): the last at-bat a game resolved,
 * complete enough for a client to render its reveal from this alone.
 *
 * WHY IT EXISTS. `getActiveDuel` reports the last resolved at-bat only until a
 * seat commits to the next one, and the bot commits the moment an at-bat opens
 * (SAN-58) — so against the bot its resolved view is gone before a client can
 * rely on seeing it. This query has no such window: it reads the log, and the
 * log only grows.
 *
 * THE VAULT IS NOT REACHABLE FROM HERE. This module reads `atBats` and never
 * `duelCommitments`. A log row exists only once both sides have locked and the
 * server has resolved (ADR-0016), so every number this returns is already
 * public to both participants — and a number committed to the at-bat now open
 * sits in a table this module does not query.
 *
 * ABSOLUTE, like the game read model (ADR-0025, ADR-0030): every total is
 * home/away and the answer is the same for both participants.
 */

/** One total per club. */
interface ClubTotals {
  home: number
  away: number
}

/** The persisted half as the engine's enum; the literal equals the enum's value,
 * so the cast relabels only. */
const halfOf = (atBat: Doc<'atBats'>): Half => atBat.half as Half

/** A club's pair with `amount` added to the club that batted this at-bat — away
 * in the top half, home in the bottom (SAN-21). */
function creditBatting(totals: ClubTotals, atBat: Doc<'atBats'>, amount: number): ClubTotals {
  return halfOf(atBat) === Half.Top
    ? { home: totals.home, away: totals.away + amount }
    : { home: totals.home + amount, away: totals.away }
}

const hitsOf = (atBat: Doc<'atBats'>): number => (isHitBand(atBat.outcome) ? 1 : 0)

/** The board as the log had left it before its last row: each club's runs and
 * hits, folded from every earlier at-bat. */
function boardBefore(earlier: readonly Doc<'atBats'>[]): { score: ClubTotals; hits: ClubTotals } {
  return earlier.reduce(
    (board, atBat) => ({
      score: creditBatting(board.score, atBat, atBat.runsScored),
      hits: creditBatting(board.hits, atBat, hitsOf(atBat)),
    }),
    { score: { home: 0, away: 0 }, hits: { home: 0, away: 0 } },
  )
}

/** The batting club's runs and hits in `last`'s half, through `last` itself. */
function halfTotalsThrough(
  log: readonly Doc<'atBats'>[],
  last: Doc<'atBats'>,
): { runs: number; hits: number } {
  return log
    .filter((atBat) => atBat.inning === last.inning && atBat.half === last.half)
    .reduce(
      (totals, atBat) => ({
        runs: totals.runs + atBat.runsScored,
        hits: totals.hits + hitsOf(atBat),
      }),
      { runs: 0, hits: 0 },
    )
}

/**
 * A logged player by name, or refuse. The log names players the authoritative
 * writer seated out of a lineup, so a dangling id is corrupt state — and a
 * reveal with a nameless batter would show a play that did not happen that way
 * (AGENTS.md: refuse rather than guess).
 */
async function namedPlayer(
  ctx: Ctx,
  id: Id<'players'>,
): Promise<{ id: Id<'players'>; name: string }> {
  const player = await ctx.db.get(id)
  if (!player) throw new Error(`At-bat log references a player that no longer exists: ${id}`)
  return { id: player._id, name: player.name }
}

/** How many outs end a half. */
const OUTS_PER_HALF = 3

/** Whether the caller owns either of the game's clubs. */
async function isParticipant(ctx: Ctx, game: Doc<'games'>, user: Doc<'users'>): Promise<boolean> {
  const [home, away] = await Promise.all([
    ownsTeam(ctx, game.homeTeam, user),
    ownsTeam(ctx, game.awayTeam, user),
  ])
  return home || away
}

/**
 * The most recently resolved at-bat of a game, for a participant — or `null`.
 *
 * `null` covers four cases identically: no at-bat has resolved yet, the caller
 * owns neither club, there is no caller (or no `users` row), and the game does
 * not exist. The last three are `getGame`'s refusal to be an oracle for which
 * games exist (ADR-0025); the first is simply nothing to show.
 *
 * The whole log is read to fold the board. At a six-inning game's length that is
 * the always-correct option, as it is for `getGame`'s hit totals; if it stops
 * being cheap, the maintained rollups are where the totals belong (ADR-0004).
 */
export const getLastAtBat = query({
  args: { game: v.id('games') },
  handler: async (ctx, args): Promise<ResolvedAtBatView | null> => {
    const game = await ctx.db.get(args.game)
    if (!game) return null
    const user = await maybeUser(ctx)
    if (!user || !(await isParticipant(ctx, game, user))) return null

    const log = await ctx.db
      .query('atBats')
      .withIndex('by_game', (q) => q.eq('game', game._id))
      .collect()
    // The last row, destructured off a slice rather than indexed — no computed
    // member access (AGENTS.md).
    const [last] = log.slice(-1)
    if (!last) return null

    const [pitcher, batter] = await Promise.all([
      namedPlayer(ctx, last.pitcher),
      namedPlayer(ctx, last.batter),
    ])
    const before = boardBefore(log.slice(0, -1))
    return {
      sequence: last.sequence,
      inning: last.inning,
      half: halfOf(last),
      pitcher,
      batter,
      pitchNumber: last.pitchNumber,
      batterNumber: last.batterNumber,
      outcome: last.outcome,
      // The persisted literal equals the enum's value; the cast relabels only.
      groundBallResult: last.groundBallResult as GroundBallResult | null,
      runsScored: last.runsScored,
      outsBefore: last.outsBefore,
      outsAfter: last.outsAfter,
      basesBefore: last.basesBefore,
      basesAfter: last.basesAfter,
      scoreBefore: before.score,
      hitsBefore: before.hits,
      endedHalf: last.outsAfter >= OUTS_PER_HALF,
      halfTotals: halfTotalsThrough(log, last),
    }
  },
})
