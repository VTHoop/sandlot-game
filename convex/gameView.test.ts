// @vitest-environment edge-runtime
/// <reference types="vite/client" />
import { GameStatus, Half } from '@sandlot/engine/game'
import { convexTest } from 'convex-test'
import { describe, expect, it } from 'vitest'
import { api } from './_generated/api'
import type { Id } from './_generated/dataModel'
import { ClubSide, type GameView, SeatRole } from './gameView'
import schema from './schema'

// convex-test discovers the function modules; exclude the test files themselves.
const modules = import.meta.glob(['./**/*.ts', '!./**/*.test.ts'])

const HOME = { subject: 'home-owner' }
const AWAY = { subject: 'away-owner' }
const STRANGER = { subject: 'stranger' }

const EMPTY_BASES = { first: null, second: null, third: null }

const HITTER = { source: 'custom', role: 'hitter', position: 'CF', price: null } as const
const ARM = { source: 'custom', role: 'pitcher', position: 'P', price: null } as const

// Distinct blocks per seat so an assertion on the batter's attributes cannot pass
// by accidentally reading the pitcher's, or one hitter's by reading another's.
const AWAY_LEADOFF_ATTRS = { power: 5, contact: 4, speed: 3, eye: 2 } as const
const AWAY_SECOND_ATTRS = { power: 1, contact: 2, speed: 3, eye: 4 } as const
const HOME_LEADOFF_ATTRS = { power: 2, contact: 5, speed: 1, eye: 3 } as const
const HOME_ARM_ATTRS = { velocity: 5, movement: 4, awareness: 3, command: 2 } as const
const AWAY_ARM_ATTRS = { velocity: 2, movement: 3, awareness: 4, command: 5 } as const

/** A committed pitch and swing, chosen outside every other number the view can
 * carry (innings, outs, scores, hits, 1–5 attributes) so {@link numbersIn} can
 * assert their absence without a coincidental match. */
const PITCH = 737
const SWING = 313

interface Seed {
  game: Id<'games'>
  homeTeam: Id<'teams'>
  awayTeam: Id<'teams'>
  awayLeadoff: Id<'players'>
  awaySecond: Id<'players'>
  homeLeadoff: Id<'players'>
  homePitcher: Id<'players'>
  awayPitcher: Id<'players'>
}

/**
 * Seed a SCHEDULED game with full lineups. AWAY owns the away club (bats first),
 * HOME owns the home club (pitches first), STRANGER owns neither.
 */
async function seedScheduledGame() {
  const t = convexTest(schema, modules)
  const ids = await t.run(async (ctx): Promise<Seed> => {
    const homeUser = await ctx.db.insert('users', { clerkSubject: HOME.subject, displayName: 'H' })
    const awayUser = await ctx.db.insert('users', { clerkSubject: AWAY.subject, displayName: 'A' })
    await ctx.db.insert('users', { clerkSubject: STRANGER.subject, displayName: 'S' })

    const homeTeam = await ctx.db.insert('teams', { owner: homeUser, name: 'Ridgeview Rail' })
    const awayTeam = await ctx.db.insert('teams', { owner: awayUser, name: 'Harbor Kingfishers' })

    const awayLeadoff = await ctx.db.insert('players', {
      name: 'R. VANCE',
      ...HITTER,
      attributes: AWAY_LEADOFF_ATTRS,
    })
    const awaySecond = await ctx.db.insert('players', {
      name: 'T. JULIEN',
      ...HITTER,
      attributes: AWAY_SECOND_ATTRS,
    })
    const awayPitcher = await ctx.db.insert('players', {
      name: 'G. PIKE',
      ...ARM,
      attributes: AWAY_ARM_ATTRS,
    })
    const homeLeadoff = await ctx.db.insert('players', {
      name: 'J. WHITLOCK',
      ...HITTER,
      attributes: HOME_LEADOFF_ATTRS,
    })
    const homePitcher = await ctx.db.insert('players', {
      name: 'H. MARSH',
      ...ARM,
      attributes: HOME_ARM_ATTRS,
    })

    const game = await ctx.db.insert('games', {
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
    })
    await ctx.db.insert('lineups', {
      game,
      team: awayTeam,
      battingOrder: [
        { player: awayLeadoff, position: 'CF' },
        { player: awaySecond, position: 'SS' },
      ],
      pitcher: awayPitcher,
    })
    await ctx.db.insert('lineups', {
      game,
      team: homeTeam,
      battingOrder: [{ player: homeLeadoff, position: 'CF' }],
      pitcher: homePitcher,
    })
    return {
      game,
      homeTeam,
      awayTeam,
      awayLeadoff,
      awaySecond,
      homeLeadoff,
      homePitcher,
      awayPitcher,
    }
  })
  return { t, ...ids }
}

type Harness = Awaited<ReturnType<typeof seedScheduledGame>>['t']

const read = (t: Harness, identity: { subject: string }, game: Id<'games'>) =>
  t.withIdentity(identity).query(api.gameView.getGame, { game })

type LiveView = Extract<GameView, { status: GameStatus.Live }>
type FinalView = Extract<GameView, { status: GameStatus.Final }>

/** Narrow to the live variant, failing the test rather than the type system if the
 * read came back scheduled, final, or null. */
function live(view: GameView | null): LiveView {
  if (!view || view.status !== GameStatus.Live) {
    throw new Error(`expected a live view, got ${view?.status}`)
  }
  return view
}

function final(view: GameView | null): FinalView {
  if (!view || view.status !== GameStatus.Final) {
    throw new Error(`expected a final view, got ${view?.status}`)
  }
  return view
}

/**
 * Every number anywhere in a payload. Shape-independent on purpose: a secrecy
 * assertion must survive the view growing a field, so it asks "is this number
 * anywhere in what crossed the wire" rather than naming the fields it trusts.
 */
function numbersIn(value: unknown): number[] {
  if (typeof value === 'number') return [value]
  if (Array.isArray(value)) return value.flatMap(numbersIn)
  if (value !== null && typeof value === 'object') return Object.values(value).flatMap(numbersIn)
  return []
}

/** Retire the side at bat, three swings at a number as far from the pitch as the
 * ring allows — the worst band for the batter, so the half flips without scoring. */
async function strikeOutTheSide(t: Harness, game: Id<'games'>) {
  const fielding = live(await read(t, HOME, game))
  const pitcher = fielding.viewerSeat === SeatRole.Pitching ? HOME : AWAY
  const batter = pitcher === HOME ? AWAY : HOME
  for (let i = 0; i < 3; i += 1) {
    await t.withIdentity(pitcher).mutation(api.atBat.commitPitch, { game, number: 1 })
    await t.withIdentity(batter).mutation(api.atBat.commitSwing, { game, number: 500 })
  }
}

describe('getGame — the participant gate', () => {
  it('is not an existence oracle: stranger, unauthenticated, and unknown id all read null', async () => {
    const { t, game, homeTeam, awayTeam } = await seedScheduledGame()

    expect(await read(t, STRANGER, game)).toBeNull()
    expect(await t.query(api.gameView.getGame, { game })).toBeNull()

    // A well-formed id for a game that is not there — indistinguishable from the
    // two refusals above, so no caller can probe which games exist.
    const vanished = await t.run(async (ctx) => {
      const id = await ctx.db.insert('games', {
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
      })
      await ctx.db.delete(id)
      return id
    })
    expect(await read(t, HOME, vanished)).toBeNull()
  })

  it('reads for a signed-in caller who has no users row as it does for no caller at all', async () => {
    const { t, game } = await seedScheduledGame()
    expect(await read(t, { subject: 'never-provisioned' }, game)).toBeNull()
  })
})

describe('getGame — scheduled', () => {
  it('names the matchup and carries no live fields', async () => {
    const { t, game, homeTeam, awayTeam } = await seedScheduledGame()

    const view = await read(t, AWAY, game)

    expect(view).toEqual({
      id: game,
      status: GameStatus.Scheduled,
      home: { id: homeTeam, name: 'Ridgeview Rail' },
      away: { id: awayTeam, name: 'Harbor Kingfishers' },
      viewer: ClubSide.Away,
    })
  })

  it('tells the home owner they are the home side', async () => {
    const { t, game } = await seedScheduledGame()
    expect((await read(t, HOME, game))?.viewer).toBe(ClubSide.Home)
  })
})

describe('getGame — live', () => {
  it('returns the opening situation with both seats resolved to renderable players', async () => {
    const { t, game, awayLeadoff, homePitcher } = await seedScheduledGame()
    await t.withIdentity(HOME).mutation(api.game.startGame, { game })

    const view = live(await read(t, AWAY, game))

    expect(view).toMatchObject({
      status: GameStatus.Live,
      inning: 1,
      half: Half.Top,
      outs: 0,
      bases: EMPTY_BASES,
      score: { home: 0, away: 0 },
      hits: { home: 0, away: 0 },
      batter: { id: awayLeadoff, name: 'R. VANCE', attributes: AWAY_LEADOFF_ATTRS },
      pitcher: { id: homePitcher, name: 'H. MARSH', attributes: HOME_ARM_ATTRS },
      locks: { pitchCommitted: false, swingCommitted: false },
    })
  })

  it('hands both participants the same absolute payload, differing only in who they are', async () => {
    const { t, game } = await seedScheduledGame()
    await t.withIdentity(HOME).mutation(api.game.startGame, { game })

    const {
      viewer: awayViewer,
      viewerSeat: awaySeat,
      ...awayRest
    } = live(await read(t, AWAY, game))
    const {
      viewer: homeViewer,
      viewerSeat: homeSeat,
      ...homeRest
    } = live(await read(t, HOME, game))

    expect(awayRest).toEqual(homeRest)
    expect(awayViewer).toBe(ClubSide.Away)
    expect(homeViewer).toBe(ClubSide.Home)
    expect(awaySeat).toBe(SeatRole.Batting)
    expect(homeSeat).toBe(SeatRole.Pitching)
  })

  it('swaps each side’s seat when the half flips', async () => {
    const { t, game, homeLeadoff, awayPitcher } = await seedScheduledGame()
    await t.withIdentity(HOME).mutation(api.game.startGame, { game })
    await strikeOutTheSide(t, game)

    const view = live(await read(t, AWAY, game))
    expect(view.half).toBe(Half.Bottom)
    expect(view.viewerSeat).toBe(SeatRole.Pitching)
    expect(live(await read(t, HOME, game)).viewerSeat).toBe(SeatRole.Batting)
    expect(view.batter).toMatchObject({ id: homeLeadoff, name: 'J. WHITLOCK' })
    expect(view.pitcher).toMatchObject({ id: awayPitcher, name: 'G. PIKE' })
  })

  it('resolves on-base runners to identity, not bare ids', async () => {
    const { t, game, awaySecond } = await seedScheduledGame()
    await t.withIdentity(HOME).mutation(api.game.startGame, { game })
    // Seat a runner directly: this is the read model's test, and the base-running
    // that would produce one is the resolver's (SAN-20/SAN-44), already covered there.
    await t.run((ctx) => ctx.db.patch(game, { bases: { ...EMPTY_BASES, second: awaySecond } }))

    expect(live(await read(t, AWAY, game)).bases).toEqual({
      first: null,
      second: { id: awaySecond, name: 'T. JULIEN' },
      third: null,
    })
  })

  it('credits a hit to the club that was batting when it was struck', async () => {
    const { t, game } = await seedScheduledGame()
    await t.withIdentity(HOME).mutation(api.game.startGame, { game })
    // An exact match on the ring is a home run — the away club is batting the top.
    await t.withIdentity(HOME).mutation(api.atBat.commitPitch, { game, number: 500 })
    await t.withIdentity(AWAY).mutation(api.atBat.commitSwing, { game, number: 500 })

    const view = live(await read(t, HOME, game))
    expect(view.hits).toEqual({ home: 0, away: 1 })
    expect(view.score).toEqual({ home: 0, away: 1 })
  })

  it('keeps each club’s hits its own across a half flip', async () => {
    const { t, game } = await seedScheduledGame()
    await t.withIdentity(HOME).mutation(api.game.startGame, { game })
    await t.withIdentity(HOME).mutation(api.atBat.commitPitch, { game, number: 500 })
    await t.withIdentity(AWAY).mutation(api.atBat.commitSwing, { game, number: 500 })
    await strikeOutTheSide(t, game)
    // Bottom of the 1st: the home club bats, and its home run is its own.
    await t.withIdentity(AWAY).mutation(api.atBat.commitPitch, { game, number: 500 })
    await t.withIdentity(HOME).mutation(api.atBat.commitSwing, { game, number: 500 })

    expect(live(await read(t, AWAY, game)).hits).toEqual({ home: 1, away: 1 })
  })

  it('refuses to render a live row with nobody seated rather than inventing a seat', async () => {
    const { t, game } = await seedScheduledGame()
    await t.withIdentity(HOME).mutation(api.game.startGame, { game })
    await t.run((ctx) => ctx.db.patch(game, { currentBatter: null }))

    await expect(read(t, AWAY, game)).rejects.toThrow()
  })
})

describe('getGame — the vault holds', () => {
  it('tells the batter that the pitch is locked, and never what it is', async () => {
    const { t, game } = await seedScheduledGame()
    await t.withIdentity(HOME).mutation(api.game.startGame, { game })
    await t.withIdentity(HOME).mutation(api.atBat.commitPitch, { game, number: PITCH })

    const view = live(await read(t, AWAY, game))
    expect(view.locks).toEqual({ pitchCommitted: true, swingCommitted: false })
    expect(numbersIn(view)).not.toContain(PITCH)
  })

  it('tells the pitcher that the swing is locked, and never what it is', async () => {
    const { t, game } = await seedScheduledGame()
    await t.withIdentity(HOME).mutation(api.game.startGame, { game })
    await t.withIdentity(AWAY).mutation(api.atBat.commitSwing, { game, number: SWING })

    const view = live(await read(t, HOME, game))
    expect(view.locks).toEqual({ pitchCommitted: false, swingCommitted: true })
    expect(numbersIn(view)).not.toContain(SWING)
  })

  it('withholds a resolved at-bat’s numbers too — the reveal is getActiveDuel’s to give', async () => {
    const { t, game } = await seedScheduledGame()
    await t.withIdentity(HOME).mutation(api.game.startGame, { game })
    await t.withIdentity(HOME).mutation(api.atBat.commitPitch, { game, number: PITCH })
    await t.withIdentity(AWAY).mutation(api.atBat.commitSwing, { game, number: SWING })

    const view = live(await read(t, AWAY, game))
    expect(numbersIn(view)).not.toContain(PITCH)
    expect(numbersIn(view)).not.toContain(SWING)
  })
})

describe('getGame — advancing', () => {
  it('returns the advanced row with the locks reset for the next duel', async () => {
    const { t, game, awaySecond } = await seedScheduledGame()
    await t.withIdentity(HOME).mutation(api.game.startGame, { game })
    await t.withIdentity(HOME).mutation(api.atBat.commitPitch, { game, number: 500 })
    await t.withIdentity(AWAY).mutation(api.atBat.commitSwing, { game, number: 500 })

    const view = live(await read(t, AWAY, game))
    expect(view.score).toEqual({ home: 0, away: 1 })
    expect(view.batter.id).toBe(awaySecond)
    expect(view.locks).toEqual({ pitchCommitted: false, swingCommitted: false })
  })
})

describe('getGame — final', () => {
  it('reports the result and hits, and seats nobody', async () => {
    const { t, game } = await seedScheduledGame()
    await t.withIdentity(HOME).mutation(api.game.startGame, { game })
    await t.withIdentity(HOME).mutation(api.atBat.commitPitch, { game, number: 500 })
    await t.withIdentity(AWAY).mutation(api.atBat.commitSwing, { game, number: 500 })
    // Seal the row where a real sixth inning would have left it.
    await t.run((ctx) =>
      ctx.db.patch(game, {
        status: 'final',
        homeScore: 3,
        awayScore: 1,
        currentBatter: null,
        currentPitcher: null,
      }),
    )

    const view = final(await read(t, AWAY, game))
    expect(view.score).toEqual({ home: 3, away: 1 })
    expect(view.hits).toEqual({ home: 0, away: 1 })
    expect(view.winner).toBe(ClubSide.Home)
    expect(view).not.toHaveProperty('batter')
    expect(view).not.toHaveProperty('pitcher')
    expect(view).not.toHaveProperty('bases')
    expect(view).not.toHaveProperty('locks')
  })

  it('names the away club the winner when it outscored the home club', async () => {
    const { t, game } = await seedScheduledGame()
    await t.run((ctx) => ctx.db.patch(game, { status: 'final', homeScore: 2, awayScore: 5 }))
    expect(final(await read(t, HOME, game)).winner).toBe(ClubSide.Away)
  })

  it('names no winner on a tied row rather than crowning the trailing club', async () => {
    const { t, game } = await seedScheduledGame()
    // The engine's end-of-game rule cannot produce a tie (`isDecidedInning`), so
    // this row is unreachable in play — the view refuses to guess regardless.
    await t.run((ctx) => ctx.db.patch(game, { status: 'final', homeScore: 4, awayScore: 4 }))
    expect(final(await read(t, HOME, game)).winner).toBeNull()
  })

  it('still refuses a non-participant once the game is over', async () => {
    const { t, game } = await seedScheduledGame()
    await t.run((ctx) => ctx.db.patch(game, { status: 'final', homeScore: 3, awayScore: 1 }))
    expect(await read(t, STRANGER, game)).toBeNull()
  })
})
