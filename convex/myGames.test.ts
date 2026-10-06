// @vitest-environment edge-runtime
/// <reference types="vite/client" />
import { GameStatus, Half } from '@sandlot/engine/game'
import type { WithoutSystemFields } from 'convex/server'
import { convexTest, type TestConvex } from 'convex-test'
import { describe, expect, it } from 'vitest'
import { api } from './_generated/api'
import type { Doc, Id } from './_generated/dataModel'
import type { GameListEntry } from './myGames'
import schema from './schema'

// convex-test discovers the function modules; exclude the test files themselves.
const modules = import.meta.glob(['./**/*.ts', '!./**/*.test.ts'])

const HOME = { subject: 'home-owner' }
const AWAY = { subject: 'away-owner' }
const THIRD = { subject: 'third-owner' }
const CLUBLESS = { subject: 'clubless' }

const EMPTY_BASES = { first: null, second: null, third: null }
const HITTER = { source: 'custom', role: 'hitter', position: 'CF', price: null } as const
const ARM = { source: 'custom', role: 'pitcher', position: 'P', price: null } as const
const HITTER_ATTRS = { power: 3, contact: 3, speed: 3, eye: 3 } as const
const ARM_ATTRS = { velocity: 3, movement: 3, awareness: 3, command: 3 } as const

/** A committed pitch chosen outside every other number a row can carry (innings,
 * scores), so its absence from a payload is not a coincidence. */
const PITCH = 737

type Harness = TestConvex<typeof schema>

interface League {
  t: Harness
  rail: Id<'teams'> // HOME's club
  kingfishers: Id<'teams'> // AWAY's club
  comets: Id<'teams'> // THIRD's club
  player: Id<'players'>
}

/** Three owners with one club each, plus a provisioned user who holds none. */
async function seedLeague(): Promise<League> {
  const t = convexTest(schema, modules)
  const ids = await t.run(async (ctx) => {
    const homeUser = await ctx.db.insert('users', { clerkSubject: HOME.subject, displayName: 'H' })
    const awayUser = await ctx.db.insert('users', { clerkSubject: AWAY.subject, displayName: 'A' })
    const thirdUser = await ctx.db.insert('users', {
      clerkSubject: THIRD.subject,
      displayName: 'T',
    })
    await ctx.db.insert('users', { clerkSubject: CLUBLESS.subject, displayName: 'C' })
    return {
      rail: await ctx.db.insert('teams', { owner: homeUser, name: 'Ridgeview Rail' }),
      kingfishers: await ctx.db.insert('teams', { owner: awayUser, name: 'Harbor Kingfishers' }),
      comets: await ctx.db.insert('teams', { owner: thirdUser, name: 'Millbrook Comets' }),
      player: await ctx.db.insert('players', {
        name: 'R. VANCE',
        ...HITTER,
        attributes: HITTER_ATTRS,
      }),
    }
  })
  return { t, ...ids }
}

type GameFields = WithoutSystemFields<Doc<'games'>>
type GameOverrides = Partial<Omit<GameFields, 'homeTeam' | 'awayTeam'>>

/** A `games` row in the scheduled state, with any fields overridden. */
const gameRow = (
  homeTeam: Id<'teams'>,
  awayTeam: Id<'teams'>,
  overrides: GameOverrides = {},
): GameFields => ({
  homeTeam,
  awayTeam,
  inning: 1,
  half: 'top',
  outs: 0,
  bases: EMPTY_BASES,
  homeScore: 0,
  awayScore: 0,
  status: 'scheduled',
  currentBatter: null,
  currentPitcher: null,
  homeBattingIndex: 0,
  awayBattingIndex: 0,
  lastResolvedSequence: -1,
  ...overrides,
})

const insertGame = (
  t: Harness,
  homeTeam: Id<'teams'>,
  awayTeam: Id<'teams'>,
  overrides: GameOverrides = {},
): Promise<Id<'games'>> =>
  t.run((ctx) => ctx.db.insert('games', gameRow(homeTeam, awayTeam, overrides)))

/** A resolved at-bat in the log at `createdAt` — the game's latest play when it
 * is the highest sequence. Only the time and order matter to the list. */
const logPlay = (
  t: Harness,
  game: Id<'games'>,
  player: Id<'players'>,
  sequence: number,
  createdAt: number,
) =>
  t.run((ctx) =>
    ctx.db.insert('atBats', {
      game,
      sequence,
      inning: 1,
      half: 'top',
      batter: player,
      pitcher: player,
      outsBefore: 0,
      basesBefore: EMPTY_BASES,
      batterNumber: 1,
      pitchNumber: 1,
      outcome: 'K',
      groundBallResult: null,
      swingType: 'normal',
      buntResult: null,
      runsScored: 0,
      rbi: 0,
      basesAfter: EMPTY_BASES,
      outsAfter: 1,
      createdAt,
    }),
  )

/** A pitch locked in the vault for the at-bat at `sequence`. */
const lockPitch = (t: Harness, game: Id<'games'>, player: Id<'players'>, sequence = 0) =>
  t.run((ctx) =>
    ctx.db.insert('duelCommitments', {
      game,
      sequence,
      role: 'pitching',
      player,
      number: PITCH,
      createdAt: 0,
    }),
  )

/** Two-hitter lineups for both clubs, so `startGame` can open the game. */
async function fieldLineups(
  t: Harness,
  game: Id<'games'>,
  homeTeam: Id<'teams'>,
  awayTeam: Id<'teams'>,
) {
  await t.run(async (ctx) => {
    for (const team of [homeTeam, awayTeam]) {
      const leadoff = await ctx.db.insert('players', {
        name: 'LEADOFF',
        ...HITTER,
        attributes: HITTER_ATTRS,
      })
      const second = await ctx.db.insert('players', {
        name: 'SECOND',
        ...HITTER,
        attributes: HITTER_ATTRS,
      })
      const pitcher = await ctx.db.insert('players', { name: 'ARM', ...ARM, attributes: ARM_ATTRS })
      await ctx.db.insert('lineups', {
        game,
        team,
        battingOrder: [
          { player: leadoff, position: 'CF' },
          { player: second, position: 'SS' },
        ],
        pitcher,
      })
    }
  })
}

/** Rail (HOME) hosting Kingfishers (AWAY), opened by `startGame`: top of the
 * first, HOME pitching, AWAY batting, neither locked. */
async function startedGame(league: League): Promise<Id<'games'>> {
  const { t, rail, kingfishers } = league
  const game = await insertGame(t, rail, kingfishers)
  await fieldLineups(t, game, rail, kingfishers)
  await t.withIdentity(HOME).mutation(api.game.startGame, { game })
  return game
}

/** Hand the Kingfishers to HOME, making HOME the owner of both clubs. */
const giveKingfishersToHome = (league: League) =>
  league.t.run(async (ctx) => {
    const home = await ctx.db
      .query('users')
      .withIndex('by_clerk_subject', (q) => q.eq('clerkSubject', HOME.subject))
      .unique()
    if (!home) throw new Error('seed has no HOME user')
    await ctx.db.patch(league.kingfishers, { owner: home._id })
  })

const list = (t: Harness, identity: { subject: string }) =>
  t.withIdentity(identity).query(api.myGames.listMyGames, {})

const ids = (rows: GameListEntry[]) => rows.map((row) => row.id)

function liveRow(row: GameListEntry | undefined) {
  if (!row || row.status !== GameStatus.Live)
    throw new Error(`expected a live row, got ${row?.status}`)
  return row
}

/** Every number anywhere in a payload — see the same helper in gameView.test.ts. */
function numbersIn(value: unknown): number[] {
  if (typeof value === 'number') return [value]
  if (Array.isArray(value)) return value.flatMap(numbersIn)
  if (value !== null && typeof value === 'object') return Object.values(value).flatMap(numbersIn)
  return []
}

describe('listMyGames — whose games', () => {
  it('lists every game the viewer holds a club in, home or away, and no other', async () => {
    const { t, rail, kingfishers, comets } = await seedLeague()
    const hosting = await insertGame(t, rail, kingfishers)
    const visiting = await insertGame(t, comets, rail)
    await insertGame(t, comets, kingfishers)

    expect(new Set(ids(await list(t, HOME)))).toEqual(new Set([hosting, visiting]))
  })

  it('lists a game the viewer holds both clubs in once', async () => {
    const league = await seedLeague()
    const game = await insertGame(league.t, league.rail, league.kingfishers)
    await giveKingfishersToHome(league)

    expect(ids(await list(league.t, HOME))).toEqual([game])
  })

  it('is empty for a viewer who holds no club, a caller with no users row, and no caller', async () => {
    const { t, rail, kingfishers } = await seedLeague()
    await insertGame(t, rail, kingfishers)

    expect(await list(t, CLUBLESS)).toEqual([])
    expect(await list(t, { subject: 'never-provisioned' })).toEqual([])
    expect(await t.query(api.myGames.listMyGames, {})).toEqual([])
  })
})

describe('listMyGames — what a row carries', () => {
  it('names both clubs and the viewer’s, and nothing else, for a scheduled game', async () => {
    const { t, rail, kingfishers } = await seedLeague()
    const game = await insertGame(t, rail, kingfishers)

    expect(await list(t, AWAY)).toEqual([
      {
        id: game,
        status: GameStatus.Scheduled,
        home: { id: rail, name: 'Ridgeview Rail' },
        away: { id: kingfishers, name: 'Harbor Kingfishers' },
        viewerOwns: { home: false, away: true },
      },
    ])
  })

  it('adds the inning, the score and whose move it is for a live game', async () => {
    const { t, rail, kingfishers } = await seedLeague()
    const game = await insertGame(t, rail, kingfishers, {
      status: 'live',
      inning: 3,
      half: 'bottom',
      homeScore: 2,
      awayScore: 1,
    })

    expect(await list(t, HOME)).toEqual([
      {
        id: game,
        status: GameStatus.Live,
        home: { id: rail, name: 'Ridgeview Rail' },
        away: { id: kingfishers, name: 'Harbor Kingfishers' },
        viewerOwns: { home: true, away: false },
        inning: 3,
        half: Half.Bottom,
        score: { home: 2, away: 1 },
        yourMove: true,
      },
    ])
  })

  it('adds only the score for a final game', async () => {
    const { t, rail, kingfishers } = await seedLeague()
    const game = await insertGame(t, rail, kingfishers, {
      status: 'final',
      inning: 6,
      homeScore: 3,
      awayScore: 4,
    })

    expect(await list(t, HOME)).toEqual([
      {
        id: game,
        status: GameStatus.Final,
        home: { id: rail, name: 'Ridgeview Rail' },
        away: { id: kingfishers, name: 'Harbor Kingfishers' },
        viewerOwns: { home: true, away: false },
        score: { home: 3, away: 4 },
      },
    ])
  })

  it('reads a final game the same whether or not the viewer dismissed its deciding play', async () => {
    const { t, rail, kingfishers, player } = await seedLeague()
    const game = await insertGame(t, rail, kingfishers, {
      status: 'final',
      homeScore: 3,
      awayScore: 4,
    })
    await logPlay(t, game, player, 0, 1_000)

    const before = await list(t, HOME)
    await t.run(async (ctx) => {
      const home = await ctx.db
        .query('users')
        .withIndex('by_clerk_subject', (q) => q.eq('clerkSubject', HOME.subject))
        .unique()
      if (!home) throw new Error('seed has no HOME user')
      await ctx.db.insert('revealDismissals', { game, user: home._id, dismissedThrough: 0 })
    })

    expect(await list(t, HOME)).toEqual(before)
    expect(before[0]?.status).toBe(GameStatus.Final)
  })
})

describe('listMyGames — your move', () => {
  it('is both players’ move at the start of an at-bat', async () => {
    const league = await seedLeague()
    await startedGame(league)

    expect(liveRow((await list(league.t, HOME))[0]).yourMove).toBe(true)
    expect(liveRow((await list(league.t, AWAY))[0]).yourMove).toBe(true)
  })

  it('waits for the player who has locked, and stays the move of the one who has not', async () => {
    const league = await seedLeague()
    const game = await startedGame(league)
    await league.t.withIdentity(HOME).mutation(api.atBat.commitPitch, { game, number: PITCH })

    expect(liveRow((await list(league.t, HOME))[0]).yourMove).toBe(false)
    expect(liveRow((await list(league.t, AWAY))[0]).yourMove).toBe(true)
  })

  it('turns back into your move when the opponent commits and the at-bat resolves', async () => {
    const league = await seedLeague()
    const game = await startedGame(league)
    await league.t.withIdentity(HOME).mutation(api.atBat.commitPitch, { game, number: PITCH })
    await league.t.withIdentity(AWAY).mutation(api.atBat.commitSwing, { game, number: 500 })

    expect(liveRow((await list(league.t, HOME))[0]).yourMove).toBe(true)
    expect(liveRow((await list(league.t, AWAY))[0]).yourMove).toBe(true)
  })

  it('stays your move for a viewer who holds both clubs while either seat is open', async () => {
    const league = await seedLeague()
    const game = await startedGame(league)
    await giveKingfishersToHome(league)
    await league.t.withIdentity(HOME).mutation(api.atBat.commitPitch, { game, number: PITCH })

    expect(liveRow((await list(league.t, HOME))[0]).yourMove).toBe(true)
  })

  it('follows the half: in the bottom, the home club bats', async () => {
    const { t, rail, kingfishers, player } = await seedLeague()
    const game = await insertGame(t, rail, kingfishers, { status: 'live', half: 'bottom' })
    await lockPitch(t, game, player) // the away club pitches the bottom half

    expect(liveRow((await list(t, AWAY))[0]).yourMove).toBe(false)
    expect(liveRow((await list(t, HOME))[0]).yourMove).toBe(true)
  })
})

describe('listMyGames — order', () => {
  it('puts live games that need the viewer first, then other live games, then scheduled, then finals', async () => {
    const { t, rail, kingfishers, player } = await seedLeague()
    const final = await insertGame(t, rail, kingfishers, { status: 'final' })
    const scheduled = await insertGame(t, rail, kingfishers)
    const waiting = await insertGame(t, rail, kingfishers, { status: 'live' })
    await lockPitch(t, waiting, player) // HOME pitches the top half and has locked
    const needsYou = await insertGame(t, rail, kingfishers, { status: 'live' })

    expect(ids(await list(t, HOME))).toEqual([needsYou, waiting, scheduled, final])
  })

  it('puts the most recent play first among live games and among finals', async () => {
    const { t, rail, kingfishers, player } = await seedLeague()
    const liveMadeFirst = await insertGame(t, rail, kingfishers, { status: 'live', startedAt: 100 })
    const liveMadeSecond = await insertGame(t, rail, kingfishers, {
      status: 'live',
      startedAt: 200,
    })
    const finalMadeFirst = await insertGame(t, rail, kingfishers, { status: 'final' })
    const finalMadeSecond = await insertGame(t, rail, kingfishers, { status: 'final' })
    // Each game's last play, out of creation order, so creation order cannot pass.
    await logPlay(t, liveMadeFirst, player, 0, 1_000)
    await logPlay(t, liveMadeFirst, player, 1, 9_000)
    await logPlay(t, liveMadeSecond, player, 0, 5_000)
    await logPlay(t, finalMadeFirst, player, 0, 8_000)
    await logPlay(t, finalMadeSecond, player, 0, 2_000)

    expect(ids(await list(t, HOME))).toEqual([
      liveMadeFirst,
      liveMadeSecond,
      finalMadeFirst,
      finalMadeSecond,
    ])
  })

  it('ranks a live game with no play yet by when it started', async () => {
    const { t, rail, kingfishers, player } = await seedLeague()
    const played = await insertGame(t, rail, kingfishers, { status: 'live', startedAt: 1_000 })
    await logPlay(t, played, player, 0, 2_000)
    const justStarted = await insertGame(t, rail, kingfishers, { status: 'live', startedAt: 3_000 })

    expect(ids(await list(t, HOME))).toEqual([justStarted, played])
  })

  it('puts the newest scheduled game first', async () => {
    const { t, rail, kingfishers } = await seedLeague()
    const older = await insertGame(t, rail, kingfishers)
    const newer = await insertGame(t, rail, kingfishers)

    expect(ids(await list(t, HOME))).toEqual([newer, older])
  })

  it('shows only the 10 most recent finals', async () => {
    const { t, rail, kingfishers, player } = await seedLeague()
    const finals: Id<'games'>[] = []
    for (let i = 0; i < 12; i++) {
      const game = await insertGame(t, rail, kingfishers, { status: 'final' })
      await logPlay(t, game, player, 0, 1_000 * (i + 1))
      finals.push(game)
    }

    expect(ids(await list(t, HOME))).toEqual(finals.slice(2).reverse())
  })
})

describe('listMyGames — secrecy', () => {
  it('never carries a committed number to either participant', async () => {
    const league = await seedLeague()
    const game = await startedGame(league)
    await league.t.withIdentity(HOME).mutation(api.atBat.commitPitch, { game, number: PITCH })

    for (const viewer of [HOME, AWAY]) {
      const rows = await list(league.t, viewer)
      expect(rows).toHaveLength(1)
      expect(numbersIn(rows)).not.toContain(PITCH)
    }
  })
})
