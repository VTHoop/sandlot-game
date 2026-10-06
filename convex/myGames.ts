import { GameStatus, type Half } from '@sandlot/engine/game'
import type { Doc, Id } from './_generated/dataModel'
import { query } from './_generated/server'
import { duelLocks } from './atBat'
import { type ClubTotals, type ClubView, clubView } from './gameView'
import { type ClubOwnership, type Ctx, maybeUser, teamsForHalf } from './participants'

/**
 * The viewer's games, for the landing screen's list (SAN-72): one row per game in
 * which the caller holds a club, in the order the list shows them.
 *
 * Like `getGame` (ADR-0025), the rows are a discriminated union on status and
 * every number in them is absolute (ADR-0030). The per-caller fields are
 * `viewerOwns`, which names the opponent, and `yourMove`.
 *
 * **Secrecy.** A row carries the inning, the score and one boolean — nothing that
 * could hold a duel number. `yourMove` is read from `atBat.duelLocks`, which
 * reports whether each seat has locked and never what it locked; this module
 * never queries `duelCommitments` itself.
 *
 * **Ordering and the finals cap are the server's**, so the times they are judged
 * by never cross the wire: live games that need the viewer, then other live
 * games, then scheduled games, then the {@link FINALS_SHOWN} most recent finals —
 * each group most-recent-activity first.
 */

/** The fields every row carries, whatever the game's status. */
interface GameListCommon {
  id: Id<'games'>
  home: ClubView
  away: ClubView
  /** Which clubs the caller holds — both, for the hotseat. Names the opponent. */
  viewerOwns: ClubOwnership
}

/** One row of the viewer's game list. */
export type GameListEntry =
  | (GameListCommon & { status: GameStatus.Scheduled })
  | (GameListCommon & {
      status: GameStatus.Live
      inning: number
      half: Half
      score: ClubTotals
      /** Whether a seat the viewer drives is still owed a number this at-bat. */
      yourMove: boolean
    })
  | (GameListCommon & { status: GameStatus.Final; score: ClubTotals })

/** How many finished games the list keeps — the most recent ones. */
export const FINALS_SHOWN = 10

/** The list's groups, in the order they are shown. */
enum Group {
  YourMove = 0,
  OtherLive = 1,
  Scheduled = 2,
  Final = 3,
}

/** A game placed in the list, before it is rendered into a row. */
interface Placed {
  game: Doc<'games'>
  owns: ClubOwnership
  group: Group
  /** When the game last moved: its latest play, else its start, else its creation. */
  activity: number
  yourMove: boolean
}

/**
 * Every game a club of the viewer's plays in, each once — an owner of both clubs
 * finds the same game through both indexes.
 */
async function gamesOfClubs(ctx: Ctx, clubs: readonly Id<'teams'>[]): Promise<Doc<'games'>[]> {
  const found = await Promise.all(
    clubs.flatMap((club) => [
      ctx.db
        .query('games')
        .withIndex('by_home_team', (q) => q.eq('homeTeam', club))
        .collect(),
      ctx.db
        .query('games')
        .withIndex('by_away_team', (q) => q.eq('awayTeam', club))
        .collect(),
    ]),
  )
  return [...new Map(found.flat().map((game) => [game._id, game])).values()]
}

/**
 * Whether a seat the viewer drives has not locked yet. Top = away bats (SAN-21).
 * Either seat may lock first (ADR-0014), so at the start of an at-bat both
 * participants are owed a number — the game screen's `turnFor` reads it the same way.
 */
async function owesNumber(ctx: Ctx, game: Doc<'games'>, owns: ClubOwnership): Promise<boolean> {
  const locks = await duelLocks(ctx, game._id)
  const homeBats = teamsForHalf(game).battingTeam === game.homeTeam
  const homeLocked = homeBats ? locks.swingCommitted : locks.pitchCommitted
  const awayLocked = homeBats ? locks.pitchCommitted : locks.swingCommitted
  return (owns.home && !homeLocked) || (owns.away && !awayLocked)
}

/** When the game last moved. A play is the latest thing to happen to a game that
 * has one; a game with none moved when it started, or else when it was made. */
async function lastActivity(ctx: Ctx, game: Doc<'games'>): Promise<number> {
  const latest = await ctx.db
    .query('atBats')
    .withIndex('by_game', (q) => q.eq('game', game._id))
    .order('desc')
    .first()
  return latest?.createdAt ?? game.startedAt ?? game._creationTime
}

async function place(ctx: Ctx, game: Doc<'games'>, owns: ClubOwnership): Promise<Placed> {
  const activity = await lastActivity(ctx, game)
  // Switched on the persisted literal — the schema layer's domain (AGENTS.md).
  if (game.status === 'scheduled') {
    return { game, owns, group: Group.Scheduled, activity, yourMove: false }
  }
  if (game.status === 'final') return { game, owns, group: Group.Final, activity, yourMove: false }
  const yourMove = await owesNumber(ctx, game, owns)
  return { game, owns, group: yourMove ? Group.YourMove : Group.OtherLive, activity, yourMove }
}

/** Group order, then most recent first within a group; finals cut to the cap. */
function ordered(placed: readonly Placed[]): Placed[] {
  const sorted = [...placed].sort((a, b) => a.group - b.group || b.activity - a.activity)
  const unfinished = sorted.filter((item) => item.group !== Group.Final)
  const finals = sorted.filter((item) => item.group === Group.Final)
  return [...unfinished, ...finals.slice(0, FINALS_SHOWN)]
}

async function entryOf(ctx: Ctx, { game, owns, yourMove }: Placed): Promise<GameListEntry> {
  const [home, away] = await Promise.all([
    clubView(ctx, game.homeTeam),
    clubView(ctx, game.awayTeam),
  ])
  const common: GameListCommon = { id: game._id, home, away, viewerOwns: owns }
  const score = { home: game.homeScore, away: game.awayScore }
  if (game.status === 'scheduled') return { ...common, status: GameStatus.Scheduled }
  if (game.status === 'final') return { ...common, status: GameStatus.Final, score }
  return {
    ...common,
    status: GameStatus.Live,
    inning: game.inning,
    // The persisted literal equals the enum's value; the cast relabels only.
    half: game.half as Half,
    score,
    yourMove,
  }
}

/**
 * The caller's games, ordered for the landing list. Empty for a caller with no
 * identity, no `users` row, or no club — the screen shows one empty state for
 * all three, and no claim UI (ADR-0028).
 */
export const listMyGames = query({
  args: {},
  handler: async (ctx): Promise<GameListEntry[]> => {
    const user = await maybeUser(ctx)
    if (!user) return []
    const clubs = await ctx.db
      .query('teams')
      .withIndex('by_owner', (q) => q.eq('owner', user._id))
      .collect()
    const held = new Set(clubs.map((club) => club._id))
    const games = await gamesOfClubs(ctx, [...held])

    const placed = await Promise.all(
      games.map((game) =>
        place(ctx, game, { home: held.has(game.homeTeam), away: held.has(game.awayTeam) }),
      ),
    )
    return Promise.all(ordered(placed).map((item) => entryOf(ctx, item)))
  },
})
