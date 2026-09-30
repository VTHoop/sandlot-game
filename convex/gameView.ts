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
 * so the situation itself reads the same for both participants. Exactly three
 * fields are resolved per caller: `viewer` (the one side they read as),
 * `viewerOwns` (every club they own — both, for the hotseat) and, while live,
 * `viewerSeat`. The duel's view-models stay absolute too (ADR-0030): the client
 * does not translate these totals into "you"/"them", and reads the per-caller
 * fields only to decide which seats it drives.
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

/**
 * One inning of a finished game's line score: the runs each club scored in its
 * half. `home` is null when the bottom half was never played — the home club
 * already led after the top of the last inning — which a line score marks "X".
 * The away club always bats, so its half is never missing.
 */
export interface InningLine {
  inning: number
  away: number
  home: number | null
}

/**
 * Which of the two clubs the caller owns — both, for the one-account hotseat
 * (ADR-0028). Two named flags rather than a list, so a reader asks for the club
 * it means instead of searching.
 */
export interface ClubOwnership {
  home: boolean
  away: boolean
}

/** The fields every variant carries, whatever the game's status. */
interface GameViewCommon {
  id: Id<'games'>
  home: ClubView
  away: ClubView
  viewer: ClubSide
  /**
   * Every club the caller owns. `viewer` names ONE side — home, for an owner of
   * both — so it cannot tell a hotseat from a home-side player. This can, and it
   * is what a client reads to decide which seats it drives.
   */
  viewerOwns: ClubOwnership
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
      /** The next two hitters due up behind the batter, in order. */
      dueUp: PlayerView[]
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
      /** Runs by inning, first to last, including any extra innings. */
      lineScore: InningLine[]
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

/** How many hitters the matchup card names behind the batter. */
const DUE_UP_COUNT = 2

/**
 * The batting club's lineup for this half. Top = away bats (SAN-21), which is the
 * same rule `teamsForHalf` applies to ownership — asked of the lineup row here
 * because the batting-order pointer lives on the game row beside it.
 */
async function battingLineup(ctx: Ctx, game: Doc<'games'>): Promise<Doc<'lineups'>> {
  const { battingTeam } = teamsForHalf(game)
  const lineup = await ctx.db
    .query('lineups')
    .withIndex('by_game', (q) => q.eq('game', game._id))
    .collect()
    .then((rows) => rows.find((row) => row.team === battingTeam))
  if (!lineup) throw new Error('A live game has no lineup for the club at bat')
  return lineup
}

/**
 * The next {@link DUE_UP_COUNT} hitters behind the batter, wrapping the order —
 * the card's DUE UP list, which it renders unconditionally. The batting index
 * points AT the current batter (the engine advances it as it folds an at-bat), so
 * the slots due up start one past it.
 *
 * The wrap is the normal case — the ninth hitter is always followed by the
 * leadoff man — so the order is repeated and sliced rather than indexed modulo
 * its length. Each slot resolves through {@link requirePlayer}, so a hitter who
 * no longer exists refuses rather than silently shortening the list into
 * something that reads as the end of the order.
 */
async function dueUpView(ctx: Ctx, game: Doc<'games'>): Promise<PlayerView[]> {
  const lineup = await battingLineup(ctx, game)
  const order = lineup.battingOrder
  if (!order.length) throw new Error('A live game has an empty batting order for the club at bat')
  const index = game.half === 'top' ? game.awayBattingIndex : game.homeBattingIndex

  // Repeat the order until it reaches {@link DUE_UP_COUNT} slots past any
  // starting index, so the wrap falls out of a plain slice. Modular indexing
  // would read it with a computed key, the object-injection sink this codebase
  // keeps off (AGENTS.md § Code conventions).
  const repeats = Math.ceil((order.length + DUE_UP_COUNT) / order.length)
  const wrapped = Array.from({ length: repeats }, () => order).flat()
  const slots = wrapped.slice(index + 1, index + 1 + DUE_UP_COUNT)

  return Promise.all(
    slots.map(async (slot) => {
      const player = await requirePlayer(ctx, slot.player)
      return { id: player._id, name: player.name }
    }),
  )
}

async function clubView(ctx: Ctx, id: Id<'teams'>): Promise<ClubView> {
  const club = await ctx.db.get(id)
  if (!club) throw new Error(`Game references a club that no longer exists: ${id}`)
  return { id: club._id, name: club.name }
}

// ─── Derived totals ─────────────────────────────────────────────────────────

/**
 * A game's whole at-bat log, in order. Rebuilding totals from it per read is the
 * always-correct option at a six-inning game's log length. If it ever stops being
 * cheap, the maintained `boxScoreLine` rollup is where the totals belong
 * (ADR-0004) — not a field on the live row.
 */
function atBatLog(ctx: Ctx, game: Id<'games'>): Promise<Doc<'atBats'>[]> {
  return ctx.db
    .query('atBats')
    .withIndex('by_game', (q) => q.eq('game', game))
    .collect()
}

/**
 * Each club's hits, folded out of the at-bat log. Nothing on the `games` row
 * tracks them — the fixture adapter keeps its own running count in memory — and
 * the log already records both the outcome band and the half it was struck in,
 * which names the club that was batting (top = away, SAN-21).
 */
function hitTotalsOf(log: readonly Doc<'atBats'>[]): ClubTotals {
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

/** The runs scored in one half, or null when the log has no row for it — the
 * half was never played. A played half always has a row: it takes three outs,
 * or a walk-off's winning run, to end one. */
function halfRuns(log: readonly Doc<'atBats'>[], inning: number, half: Half): number | null {
  const rows = log.filter((atBat) => atBat.inning === inning && (atBat.half as Half) === half)
  if (!rows.length) return null
  return rows.reduce((runs, atBat) => runs + atBat.runsScored, 0)
}

/**
 * A finished game's runs by inning, from the first inning to the last one the log
 * reaches — extra innings included, since nothing caps them (ADR-0017).
 *
 * Only a bottom half can be missing: the engine skips it when the home club
 * already leads after the top of the last inning. Every inning's top half is
 * always played, so a gap there is corrupt state, and this refuses rather than
 * rendering an inning nobody played.
 */
function lineScoreOf(log: readonly Doc<'atBats'>[]): InningLine[] {
  const lastInning = log.reduce((last, atBat) => Math.max(last, atBat.inning), 0)
  return Array.from({ length: lastInning }, (_, index) => {
    const inning = index + 1
    const away = halfRuns(log, inning, Half.Top)
    if (away === null) {
      throw new Error(`A final game's at-bat log skips the top of inning ${inning}`)
    }
    return { inning, away, home: halfRuns(log, inning, Half.Bottom) }
  })
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

/** Which of the game's two clubs the caller owns. The two lookups are
 * independent, so they go out together. Exported for the resolved at-bat read
 * model, which gates on the same question. */
export async function ownershipOf(
  ctx: Ctx,
  game: Doc<'games'>,
  user: Doc<'users'>,
): Promise<ClubOwnership> {
  const [home, away] = await Promise.all([
    ownsTeam(ctx, game.homeTeam, user),
    ownsTeam(ctx, game.awayTeam, user),
  ])
  return { home, away }
}

/**
 * The one side `viewer` names, or null when the caller owns neither club. Home
 * wins, so a caller who owns BOTH — the one-account hotseat — reads as the home
 * side and their seat follows the half like anyone else's. `viewerOwns` is what
 * tells that caller apart.
 */
function viewerSideOf(owns: ClubOwnership): ClubSide | null {
  if (owns.home) return ClubSide.Home
  if (owns.away) return ClubSide.Away
  return null
}

// ─── Variants ───────────────────────────────────────────────────────────────

async function liveView(ctx: Ctx, game: Doc<'games'>, common: GameViewCommon): Promise<GameView> {
  const viewerTeam = common.viewer === ClubSide.Home ? game.homeTeam : game.awayTeam
  const [bases, batter, pitcher, dueUp, log, locks] = await Promise.all([
    basesView(ctx, game.bases),
    seatView(ctx, game.currentBatter, SeatRole.Batting),
    seatView(ctx, game.currentPitcher, SeatRole.Pitching),
    dueUpView(ctx, game),
    atBatLog(ctx, game._id),
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
    hits: hitTotalsOf(log),
    batter,
    pitcher,
    dueUp,
    viewerSeat:
      viewerTeam === teamsForHalf(game).battingTeam ? SeatRole.Batting : SeatRole.Pitching,
    // Destructured rather than spread: `duelLocks` also carries the at-bat's
    // ordinal, which is the vault's business and not the read model's.
    locks: { pitchCommitted: locks.pitchCommitted, swingCommitted: locks.swingCommitted },
  }
}

async function finalView(ctx: Ctx, game: Doc<'games'>, common: GameViewCommon): Promise<GameView> {
  const log = await atBatLog(ctx, game._id)
  return {
    ...common,
    status: GameStatus.Final,
    score: { home: game.homeScore, away: game.awayScore },
    hits: hitTotalsOf(log),
    winner: winnerOf(game),
    lineScore: lineScoreOf(log),
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
 * The id arrives as a plain string because the client reads it off the address
 * bar (`/game/:id`, SAN-38): a typo or another table's id is untrusted input, and
 * `normalizeId` folds it into "resolves to nothing" rather than letting argument
 * validation throw past the not-found screen.
 *
 * The participant-only gate is the safe default rather than a law. Roadmap result
 * sharing means a stranger reading a `final` game; relaxing it for that status
 * belongs to that work, and to a deliberate decision there.
 */
export const getGame = query({
  args: { game: v.string() },
  handler: async (ctx, args): Promise<GameView | null> => {
    const id = ctx.db.normalizeId('games', args.game)
    if (!id) return null
    const game = await ctx.db.get(id)
    if (!game) return null

    const user = await maybeUser(ctx)
    if (!user) return null
    const viewerOwns = await ownershipOf(ctx, game, user)
    const viewer = viewerSideOf(viewerOwns)
    if (!viewer) return null

    const [home, away] = await Promise.all([
      clubView(ctx, game.homeTeam),
      clubView(ctx, game.awayTeam),
    ])
    const common: GameViewCommon = { id: game._id, home, away, viewer, viewerOwns }

    // Switched on the persisted literal — the schema layer's domain (AGENTS.md
    // "Enums over magic strings"); the variant it builds carries the enum.
    if (game.status === 'live') return liveView(ctx, game, common)
    if (game.status === 'final') return finalView(ctx, game, common)
    return { ...common, status: GameStatus.Scheduled }
  },
})
