import { GameStatus, Half } from '@sandlot/engine/game'
import { isHitBand } from '@sandlot/engine/outcomes'
import { v } from 'convex/values'
import type { Doc, Id } from './_generated/dataModel'
import { query } from './_generated/server'
import { duelLocks } from './atBat'
import { type Ctx, maybeUser, ownsTeam, teamsForHalf } from './participants'

/**
 * The secret-safe live game read model (SAN-56) — the one query a client
 * subscribes to for the situation around the duel, and the read half of the
 * Convex-backed adapter (SAN-57).
 *
 * It lives beside `game.ts` rather than inside it on purpose. That module's whole
 * contract is that it is the authoritative WRITER and no client read path (ADR-0004
 * / ADR-0017); this one is the opposite, and it is the highest-risk surface in the
 * project for the secrecy invariant — the batter's client subscribes to it while
 * the pitch is already sitting in the vault. Keeping the outbound shape in one
 * file means "what crosses the wire" is reviewable in one place.
 *
 * **No committed duel number is reachable from here, structurally.** This module
 * never queries `duelCommitments`; it asks `atBat.duelLocks` (the vault's own
 * module) and receives two booleans. That a side has locked is the only
 * pre-resolution cross-player signal (ADR-0014); a resolved at-bat's numbers are
 * `getActiveDuel`'s to reveal, not this query's.
 *
 * PERSPECTIVE — every number here is ABSOLUTE (home/away), never "you"/"them",
 * so the situation itself reads the same for both participants. Exactly two
 * fields are resolved per caller: `viewer` (which club they own) and, while live,
 * `viewerSeat`. The client flips the shared half against those. The prototype
 * adapter keys "you" off the batting side (`src/design/duel/adapter.ts` module
 * header); that is the `viewer` input it was waiting for.
 */

/** Which club of the matchup a value belongs to. */
export enum ClubSide {
  Home = 'home',
  Away = 'away',
}

/** Which seat a club occupies in the at-bat currently on the field. */
export enum SeatRole {
  Batting = 'batting',
  Pitching = 'pitching',
}

/** A club, named. */
export interface ClubView {
  id: Id<'teams'>
  name: string
}

/**
 * Anyone standing on the field. Identity and a display name, so a screen can name
 * a runner whether or not one does today — and nothing that could carry a number.
 */
export interface PlayerView {
  id: Id<'players'>
  name: string
}

/**
 * A seated player plus the attribute block the matchup card reads. The block is
 * the union the `players` row carries rather than the role-specific half, because
 * the seat does not guarantee the role: a pitcher can come to the plate (the bunt
 * bonus, §3.4.3 / ADR-0021). The client discriminates on the block, as
 * `deriveMatchup` already does.
 */
export interface SeatView extends PlayerView {
  attributes: Doc<'players'>['attributes']
}

/** Who is standing on each base, or null when it is empty. */
export interface BasesView {
  first: PlayerView | null
  second: PlayerView | null
  third: PlayerView | null
}

/** One absolute total per club — see the module header on perspective. */
export interface ClubTotals {
  home: number
  away: number
}

/**
 * Whether each seat has locked for the at-bat on the field: a boolean per role,
 * never a number. Resets on its own once an at-bat resolves — the locks are read
 * at the current ordinal, and resolution advances it.
 */
export interface LockView {
  pitchCommitted: boolean
  swingCommitted: boolean
}

/** The fields every variant carries, whatever the game's status. */
interface GameViewCommon {
  id: Id<'games'>
  home: ClubView
  away: ClubView
  viewer: ClubSide
}

/**
 * The authoritative game state as a participant may read it, as a discriminated
 * union on status rather than one shape with nullable seats. A finished game has
 * no batter and a scheduled one has no bases, so reading either is a compile
 * error here instead of a null check every screen has to remember (ADR-0022 made
 * the same call for the reveal stage: divergence structural, not a prop).
 */
export type GameView =
  | (GameViewCommon & { status: GameStatus.Scheduled })
  | (GameViewCommon & {
      status: GameStatus.Live
      inning: number
      half: Half
      outs: number
      bases: BasesView
      score: ClubTotals
      hits: ClubTotals
      batter: SeatView
      pitcher: SeatView
      /** Whether the viewer's own club is batting or pitching this half. */
      viewerSeat: SeatRole
      locks: LockView
    })
  | (GameViewCommon & {
      status: GameStatus.Final
      score: ClubTotals
      hits: ClubTotals
      /** The club that won, or null — see {@link winnerOf}. */
      winner: ClubSide | null
    })

// ─── Resolving references to renderable data ────────────────────────────────

/**
 * A player row, or refuse. Every player id this module resolves was written by
 * the authoritative writer out of a lineup, so a dangling one is corrupt state —
 * and quietly rendering an empty base or a nameless seat would show the player a
 * situation that is not the real one.
 */
async function requirePlayer(ctx: Ctx, id: Id<'players'>): Promise<Doc<'players'>> {
  const player = await ctx.db.get(id)
  if (!player) throw new Error(`Game references a player that no longer exists: ${id}`)
  return player
}

async function seatView(ctx: Ctx, id: Id<'players'> | null, seat: SeatRole): Promise<SeatView> {
  if (!id) throw new Error(`A live game has nobody in the ${seat} seat`)
  const player = await requirePlayer(ctx, id)
  return { id: player._id, name: player.name, attributes: player.attributes }
}

async function runnerView(ctx: Ctx, id: Id<'players'> | null): Promise<PlayerView | null> {
  if (!id) return null
  const player = await requirePlayer(ctx, id)
  return { id: player._id, name: player.name }
}

/** The runner-aware bases (SAN-44/ADR-0018) with each occupant resolved. The three
 * lookups are independent, so they go out together. */
async function basesView(ctx: Ctx, bases: Doc<'games'>['bases']): Promise<BasesView> {
  const [first, second, third] = await Promise.all([
    runnerView(ctx, bases.first),
    runnerView(ctx, bases.second),
    runnerView(ctx, bases.third),
  ])
  return { first, second, third }
}

async function clubView(ctx: Ctx, id: Id<'teams'>): Promise<ClubView> {
  const club = await ctx.db.get(id)
  if (!club) throw new Error(`Game references a club that no longer exists: ${id}`)
  return { id: club._id, name: club.name }
}

// ─── Derived totals ─────────────────────────────────────────────────────────

/**
 * Each club's hits, folded out of the at-bat log. Nothing on the `games` row
 * tracks them — the prototype kept them in adapter memory (`rollHitTotals`) — and
 * the log already records both the outcome band and the half it was struck in,
 * which names the club that was batting (top = away, SAN-21).
 *
 * Rebuilding the pair per read is the always-correct option at a six-inning
 * game's log length. If it ever stops being cheap, the maintained `boxScoreLine`
 * rollup is where the totals belong (ADR-0004) — not a field on the live row.
 */
async function hitTotals(ctx: Ctx, game: Id<'games'>): Promise<ClubTotals> {
  const log = await ctx.db
    .query('atBats')
    .withIndex('by_game', (q) => q.eq('game', game))
    .collect()
  return log.reduce<ClubTotals>(
    (totals, atBat) => {
      if (!isHitBand(atBat.outcome)) return totals
      // The persisted literal equals the enum's value; the cast relabels only.
      return (atBat.half as Half) === Half.Top
        ? { home: totals.home, away: totals.away + 1 }
        : { home: totals.home + 1, away: totals.away }
    },
    { home: 0, away: 0 },
  )
}

/**
 * The club that won. The engine seals a game only on a decided inning
 * (`isDecidedInning` — a tie plays on into extras), so a tied `final` row is
 * unreachable in play; if one ever appears, naming nobody beats crowning the
 * club that happens to be listed second.
 */
function winnerOf(game: Doc<'games'>): ClubSide | null {
  if (game.homeScore > game.awayScore) return ClubSide.Home
  if (game.awayScore > game.homeScore) return ClubSide.Away
  return null
}

// ─── The gate ───────────────────────────────────────────────────────────────

/**
 * Which club the caller owns, or null when they own neither. Home is checked
 * first, so a caller who owns BOTH clubs — the dev seed's single-owner hotseat —
 * reads as the home side and their seat follows the half like anyone else's.
 */
async function viewerSideOf(
  ctx: Ctx,
  game: Doc<'games'>,
  user: Doc<'users'>,
): Promise<ClubSide | null> {
  if (await ownsTeam(ctx, game.homeTeam, user)) return ClubSide.Home
  if (await ownsTeam(ctx, game.awayTeam, user)) return ClubSide.Away
  return null
}

// ─── Variants ───────────────────────────────────────────────────────────────

async function liveView(ctx: Ctx, game: Doc<'games'>, common: GameViewCommon): Promise<GameView> {
  const viewerTeam = common.viewer === ClubSide.Home ? game.homeTeam : game.awayTeam
  const [bases, batter, pitcher, hits, locks] = await Promise.all([
    basesView(ctx, game.bases),
    seatView(ctx, game.currentBatter, SeatRole.Batting),
    seatView(ctx, game.currentPitcher, SeatRole.Pitching),
    hitTotals(ctx, game._id),
    duelLocks(ctx, game._id),
  ])
  return {
    ...common,
    status: GameStatus.Live,
    inning: game.inning,
    // The persisted literal equals the enum's value; the cast relabels only.
    half: game.half as Half,
    outs: game.outs,
    bases,
    score: { home: game.homeScore, away: game.awayScore },
    hits,
    batter,
    pitcher,
    viewerSeat:
      viewerTeam === teamsForHalf(game).battingTeam ? SeatRole.Batting : SeatRole.Pitching,
    // Destructured rather than spread: `duelLocks` also carries the at-bat's
    // ordinal, which is the vault's business and not the read model's.
    locks: { pitchCommitted: locks.pitchCommitted, swingCommitted: locks.swingCommitted },
  }
}

async function finalView(ctx: Ctx, game: Doc<'games'>, common: GameViewCommon): Promise<GameView> {
  return {
    ...common,
    status: GameStatus.Final,
    score: { home: game.homeScore, away: game.awayScore },
    hits: await hitTotals(ctx, game._id),
    winner: winnerOf(game),
  }
}

/**
 * The authoritative state of one game, for a participant.
 *
 * Three refusals answer identically with `null` — a caller who owns neither club,
 * a caller with no identity (or no `users` row, which every gate treats the same),
 * and a game id that resolves to nothing. Indistinguishable on purpose: an error
 * that separated them would turn this query into an oracle for which games exist.
 *
 * The participant-only gate is the safe default rather than a law. Roadmap result
 * sharing means a stranger reading a `final` game; relaxing it for that status
 * belongs to that work, and to a deliberate decision there.
 */
export const getGame = query({
  args: { game: v.id('games') },
  handler: async (ctx, args): Promise<GameView | null> => {
    const game = await ctx.db.get(args.game)
    if (!game) return null

    const user = await maybeUser(ctx)
    const viewer = user && (await viewerSideOf(ctx, game, user))
    if (!viewer) return null

    const [home, away] = await Promise.all([
      clubView(ctx, game.homeTeam),
      clubView(ctx, game.awayTeam),
    ])
    const common: GameViewCommon = { id: game._id, home, away, viewer }

    // Switched on the persisted literal — the schema layer's domain (AGENTS.md
    // "Enums over magic strings"); the variant it builds carries the enum.
    if (game.status === 'live') return liveView(ctx, game, common)
    if (game.status === 'final') return finalView(ctx, game, common)
    return { ...common, status: GameStatus.Scheduled }
  },
})
