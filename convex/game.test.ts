// @vitest-environment edge-runtime
/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from './_generated/api'
import type { Id } from './_generated/dataModel'
import schema from './schema'

// convex-test discovers the function modules; exclude the test files themselves.
const modules = import.meta.glob(['./**/*.ts', '!./**/*.test.ts'])

const HOME = { subject: 'home-owner' }
const AWAY = { subject: 'away-owner' }
const STRANGER = { subject: 'stranger' }

const EMPTY_BASES = { first: null, second: null, third: null }

const HITTER = { source: 'custom', role: 'hitter', position: 'CF', price: null } as const
const ARM = { source: 'custom', role: 'pitcher', position: 'P', price: null } as const
const BAT_ATTRS = { power: 3, contact: 3, speed: 3, eye: 3 } as const
const ARM_ATTRS = { velocity: 3, movement: 3, awareness: 3, command: 3 } as const

interface Seed {
  game: Id<'games'>
  awayLeadoff: Id<'players'>
  awaySecond: Id<'players'>
  homePitcher: Id<'players'>
}

/**
 * Seed a SCHEDULED game with full lineups. AWAY owns the away team (bats first),
 * HOME owns the home team (pitches first), STRANGER owns neither.
 */
async function seedScheduledGame() {
  const t = convexTest(schema, modules)
  const ids = await t.run(async (ctx): Promise<Seed> => {
    const homeUser = await ctx.db.insert('users', { clerkSubject: HOME.subject, displayName: 'H' })
    const awayUser = await ctx.db.insert('users', { clerkSubject: AWAY.subject, displayName: 'A' })
    await ctx.db.insert('users', { clerkSubject: STRANGER.subject, displayName: 'S' })

    const homeTeam = await ctx.db.insert('teams', { owner: homeUser, name: 'Home' })
    const awayTeam = await ctx.db.insert('teams', { owner: awayUser, name: 'Away' })

    const awayLeadoff = await ctx.db.insert('players', {
      name: 'A1',
      ...HITTER,
      attributes: BAT_ATTRS,
    })
    const awaySecond = await ctx.db.insert('players', {
      name: 'A2',
      ...HITTER,
      attributes: BAT_ATTRS,
    })
    const awayPitcher = await ctx.db.insert('players', {
      name: 'AP',
      ...ARM,
      attributes: ARM_ATTRS,
    })
    const homeLeadoff = await ctx.db.insert('players', {
      name: 'H1',
      ...HITTER,
      attributes: BAT_ATTRS,
    })
    const homePitcher = await ctx.db.insert('players', {
      name: 'HP',
      ...ARM,
      attributes: ARM_ATTRS,
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
    return { game, awayLeadoff, awaySecond, homePitcher }
  })
  return { t, ...ids }
}

const gameRow = (t: Awaited<ReturnType<typeof seedScheduledGame>>['t'], game: Id<'games'>) =>
  t.run((ctx) => ctx.db.get(game))

describe('startGame — scheduled → live', () => {
  it('initializes the live row from the lineups', async () => {
    const { t, game, awayLeadoff, homePitcher } = await seedScheduledGame()
    await t.withIdentity(HOME).mutation(api.game.startGame, { game })

    const row = await gameRow(t, game)
    expect(row).toMatchObject({
      status: 'live',
      inning: 1,
      half: 'top',
      outs: 0,
      bases: EMPTY_BASES,
      homeScore: 0,
      awayScore: 0,
      currentBatter: awayLeadoff, // away leads off the top of the 1st
      currentPitcher: homePitcher, // home takes the mound
      homeBattingIndex: 0,
      awayBattingIndex: 0,
      lastResolvedSequence: -1,
    })
  })

  it('rejects starting a game that is not scheduled', async () => {
    const { t, game } = await seedScheduledGame()
    await t.withIdentity(HOME).mutation(api.game.startGame, { game })
    await expect(t.withIdentity(HOME).mutation(api.game.startGame, { game })).rejects.toThrow()
  })

  it('rejects a non-participant', async () => {
    const { t, game } = await seedScheduledGame()
    await expect(t.withIdentity(STRANGER).mutation(api.game.startGame, { game })).rejects.toThrow()
    expect((await gameRow(t, game))?.status).toBe('scheduled')
  })

  it('rejects an unauthenticated caller', async () => {
    const { t, game } = await seedScheduledGame()
    await expect(t.mutation(api.game.startGame, { game })).rejects.toThrow()
  })

  it('rejects a lineup with an empty batting order', async () => {
    const { t, game } = await seedScheduledGame()
    // A game can't run with nobody to bat — seating a null leadoff would be a
    // broken live state, so the load boundary rejects it outright.
    await t.run(async (ctx) => {
      const away = (await ctx.db.query('lineups').collect()).find((l) => l.game === game)
      if (away) await ctx.db.patch(away._id, { battingOrder: [] })
    })
    await expect(t.withIdentity(HOME).mutation(api.game.startGame, { game })).rejects.toThrow()
    expect((await gameRow(t, game))?.status).toBe('scheduled')
  })
})

describe('client-write invariant — live state advances only through resolution', () => {
  it('folds a resolved at-bat into the games row via the secret round-trip', async () => {
    const { t, game, awaySecond } = await seedScheduledGame()
    await t.withIdentity(HOME).mutation(api.game.startGame, { game })

    // The only client path to mutate game state: commit both secret numbers.
    // 500 vs 500 is an exact match → home run, scoring the away (batting) team.
    await t.withIdentity(HOME).mutation(api.atBat.commitPitch, { game, number: 500 })
    await t.withIdentity(AWAY).mutation(api.atBat.commitSwing, { game, number: 500 })

    const row = await gameRow(t, game)
    expect(row).toMatchObject({
      awayScore: 1,
      homeScore: 0,
      outs: 0,
      currentBatter: awaySecond, // batting-order pointer advanced
      awayBattingIndex: 1,
      lastResolvedSequence: 0,
      status: 'live',
    })
  })

  it('accrues an out without scoring on a strikeout-band duel', async () => {
    const { t, game } = await seedScheduledGame()
    await t.withIdentity(HOME).mutation(api.game.startGame, { game })

    // Maximally far apart on the ring → worst band for the batter (an out).
    await t.withIdentity(HOME).mutation(api.atBat.commitPitch, { game, number: 1 })
    await t.withIdentity(AWAY).mutation(api.atBat.commitSwing, { game, number: 500 })

    const row = await gameRow(t, game)
    expect(row?.outs).toBe(1)
    expect(row?.awayScore).toBe(0)
    expect(row?.lastResolvedSequence).toBe(0)
  })
})

describe('game timestamps — startedAt / completedAt (SAN-73)', () => {
  const STARTED = Date.UTC(2026, 9, 5, 18, 0)
  const COMPLETED = Date.UTC(2026, 9, 9, 21, 30)

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(STARTED)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  /** Start the game, then put it one out from the end: two outs in the top of the
   * last regulation inning with home ahead, so the next out makes it final. */
  async function oneOutFromFinal() {
    const seeded = await seedScheduledGame()
    const { t, game } = seeded
    await t.withIdentity(HOME).mutation(api.game.startGame, { game })
    await t.run((ctx) => ctx.db.patch(game, { inning: 6, outs: 2, homeScore: 1, awayScore: 0 }))
    return seeded
  }

  /** A strikeout-band duel: maximally far apart on the ring. */
  async function strikeOut(
    t: Awaited<ReturnType<typeof seedScheduledGame>>['t'],
    game: Id<'games'>,
  ) {
    await t.withIdentity(HOME).mutation(api.atBat.commitPitch, { game, number: 1 })
    await t.withIdentity(AWAY).mutation(api.atBat.commitSwing, { game, number: 500 })
  }

  it('a scheduled game has neither', async () => {
    const { t, game } = await seedScheduledGame()
    const row = await gameRow(t, game)
    expect(row?.startedAt).toBeUndefined()
    expect(row?.completedAt).toBeUndefined()
  })

  it('startGame stamps startedAt with the time the game went live, and nothing else', async () => {
    const { t, game } = await seedScheduledGame()
    await t.withIdentity(HOME).mutation(api.game.startGame, { game })

    const row = await gameRow(t, game)
    expect(row?.startedAt).toBe(STARTED)
    expect(row?.completedAt).toBeUndefined()
  })

  it('a repeated startGame does not move startedAt', async () => {
    const { t, game } = await seedScheduledGame()
    await t.withIdentity(HOME).mutation(api.game.startGame, { game })
    vi.setSystemTime(STARTED + 60_000)

    await expect(t.withIdentity(AWAY).mutation(api.game.startGame, { game })).rejects.toThrow()
    expect((await gameRow(t, game))?.startedAt).toBe(STARTED)
  })

  it('an at-bat that leaves the game live writes neither', async () => {
    const { t, game } = await seedScheduledGame()
    await t.withIdentity(HOME).mutation(api.game.startGame, { game })
    vi.setSystemTime(STARTED + 60_000)

    await strikeOut(t, game)

    const row = await gameRow(t, game)
    expect(row?.status).toBe('live')
    expect(row?.startedAt).toBe(STARTED)
    expect(row?.completedAt).toBeUndefined()
  })

  it('the at-bat that ends the game stamps completedAt, leaving startedAt alone', async () => {
    const { t, game } = await oneOutFromFinal()
    vi.setSystemTime(COMPLETED)

    await strikeOut(t, game)

    const row = await gameRow(t, game)
    expect(row?.status).toBe('final')
    expect(row?.startedAt).toBe(STARTED)
    expect(row?.completedAt).toBe(COMPLETED)
  })

  it('a commit arriving after the final does not move completedAt', async () => {
    const { t, game } = await oneOutFromFinal()
    vi.setSystemTime(COMPLETED)
    await strikeOut(t, game)
    vi.setSystemTime(COMPLETED + 60_000)

    await expect(
      t.withIdentity(HOME).mutation(api.atBat.commitPitch, { game, number: 1 }),
    ).rejects.toThrow()
    expect((await gameRow(t, game))?.completedAt).toBe(COMPLETED)
  })

  it('getGame sends neither field to the client, live or final', async () => {
    const { t, game } = await seedScheduledGame()
    await t.withIdentity(HOME).mutation(api.game.startGame, { game })
    const live = await t.withIdentity(HOME).query(api.gameView.getGame, { game })
    expect(live?.status).toBe('live')
    expect(live).not.toHaveProperty('startedAt')

    // Seal it without playing six innings, as gameView.test.ts does.
    await t.run((ctx) =>
      ctx.db.patch(game, { status: 'final', homeScore: 3, awayScore: 1, completedAt: COMPLETED }),
    )
    const final = await t.withIdentity(HOME).query(api.gameView.getGame, { game })
    expect(final?.status).toBe('final')
    expect(final).not.toHaveProperty('startedAt')
    expect(final).not.toHaveProperty('completedAt')
  })
})
