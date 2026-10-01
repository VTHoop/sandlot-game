// @vitest-environment edge-runtime
/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { describe, expect, it } from 'vitest'
import { api } from './_generated/api'
import type { Id } from './_generated/dataModel'
import schema from './schema'

// convex-test discovers the function modules; exclude the test files themselves.
const modules = import.meta.glob(['./**/*.ts', '!./**/*.test.ts'])

const HOME = { subject: 'home-owner' }
const AWAY = { subject: 'away-owner' }
const STRANGER = { subject: 'stranger' }

const EMPTY_BASES = { first: null, second: null, third: null }

const HITTER = {
  source: 'custom',
  role: 'hitter',
  position: 'CF',
  price: null,
  attributes: { power: 3, contact: 3, speed: 3, eye: 3 },
} as const
const ARM = {
  source: 'custom',
  role: 'pitcher',
  position: 'P',
  price: null,
  attributes: { velocity: 3, movement: 3, awareness: 3, command: 3 },
} as const

/** The widest reachable difference is the worst band for the batter: an out,
 * and nothing on the bases to complicate the fold. */
const STRIKEOUT = { pitch: 1, swing: 500 }

/**
 * A live game: AWAY bats first against HOME's pitcher. STRANGER owns neither
 * club. With `hotseat`, HOME owns both clubs and AWAY owns nothing.
 */
async function seedLiveGame({ hotseat = false } = {}) {
  const t = convexTest(schema, modules)
  const game = await t.run(async (ctx) => {
    const homeUser = await ctx.db.insert('users', { clerkSubject: HOME.subject, displayName: 'H' })
    const awayUser = await ctx.db.insert('users', { clerkSubject: AWAY.subject, displayName: 'A' })
    await ctx.db.insert('users', { clerkSubject: STRANGER.subject, displayName: 'S' })
    const homeTeam = await ctx.db.insert('teams', { owner: homeUser, name: 'Ridgeview Rail' })
    const awayTeam = await ctx.db.insert('teams', {
      owner: hotseat ? homeUser : awayUser,
      name: 'Harbor Kingfishers',
    })

    const awayHitter = await ctx.db.insert('players', { name: 'R. VANCE', ...HITTER })
    const awayPitcher = await ctx.db.insert('players', { name: 'G. PIKE', ...ARM })
    const homeHitter = await ctx.db.insert('players', { name: 'J. WHITLOCK', ...HITTER })
    const homePitcher = await ctx.db.insert('players', { name: 'H. MARSH', ...ARM })

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
    await ctx.db.insert('lineups', {
      game: id,
      team: awayTeam,
      battingOrder: [{ player: awayHitter, position: 'CF' }],
      pitcher: awayPitcher,
    })
    await ctx.db.insert('lineups', {
      game: id,
      team: homeTeam,
      battingOrder: [{ player: homeHitter, position: 'CF' }],
      pitcher: homePitcher,
    })
    return id
  })
  await t.withIdentity(HOME).mutation(api.game.startGame, { game })
  return { t, game }
}

type Harness = Awaited<ReturnType<typeof seedLiveGame>>['t']

/** Resolve one top-half strikeout: HOME pitches, and the away club's owner swings. */
async function strikeOut(t: Harness, game: Id<'games'>, awayOwner = AWAY) {
  await t.withIdentity(HOME).mutation(api.atBat.commitPitch, { game, number: STRIKEOUT.pitch })
  await t.withIdentity(awayOwner).mutation(api.atBat.commitSwing, {
    game,
    number: STRIKEOUT.swing,
  })
}

const readAs = (t: Harness, identity: { subject: string }, game: string) =>
  t.withIdentity(identity).query(api.revealDismissals.getRevealsDismissedThrough, { game })

const dismissAs = (
  t: Harness,
  identity: { subject: string },
  game: Id<'games'>,
  sequence: number,
) => t.withIdentity(identity).mutation(api.revealDismissals.dismissReveal, { game, sequence })

/** Every dismissal row a game holds. */
const rowsFor = (t: Harness, game: Id<'games'>) =>
  t.run((ctx) =>
    ctx.db
      .query('revealDismissals')
      .filter((q) => q.eq(q.field('game'), game))
      .collect(),
  )

/** A game id that once existed and no longer does. */
const vanishedGame = (t: Harness, game: Id<'games'>) =>
  t.run(async (ctx) => {
    const row = await ctx.db.get(game)
    if (!row) throw new Error('seed has no game')
    const { _id, _creationTime, ...fields } = row
    const id = await ctx.db.insert('games', fields)
    await ctx.db.delete(id)
    return id
  })

/** The message a rejected call carries, or fail the test if it did not reject. */
async function refusalOf(call: Promise<unknown>): Promise<string> {
  try {
    await call
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
  throw new Error('expected the call to be refused')
}

describe('getRevealsDismissedThrough — the participant gate', () => {
  it('reads null until the viewer has dismissed a reveal', async () => {
    const { t, game } = await seedLiveGame()
    expect(await readAs(t, AWAY, game)).toBeNull()

    await strikeOut(t, game)
    expect(await readAs(t, AWAY, game)).toBeNull()
  })

  it('reads null for a stranger, for no caller, for a game that is not there, and for an id that names no game', async () => {
    // The same single null as `getGame` and `getLastAtBat` (ADR-0025): no refusal
    // may say which games exist.
    const { t, game } = await seedLiveGame()
    await strikeOut(t, game)
    await dismissAs(t, AWAY, game, 0)

    expect(await readAs(t, STRANGER, game)).toBeNull()
    expect(await t.query(api.revealDismissals.getRevealsDismissedThrough, { game })).toBeNull()
    expect(await readAs(t, AWAY, await vanishedGame(t, game))).toBeNull()
    expect(await readAs(t, AWAY, 'not-a-game-id')).toBeNull()
  })
})

describe('dismissReveal — per viewer', () => {
  it('records the dismissed at-bat for the viewer, and for no one else', async () => {
    const { t, game } = await seedLiveGame()
    await strikeOut(t, game)

    await dismissAs(t, AWAY, game, 0)

    expect(await readAs(t, AWAY, game)).toBe(0)
    expect(await readAs(t, HOME, game)).toBeNull()
  })

  it('never moves back: dismissing an earlier at-bat after a later one keeps the later', async () => {
    const { t, game } = await seedLiveGame()
    await strikeOut(t, game)
    await strikeOut(t, game)

    await dismissAs(t, AWAY, game, 1)
    await dismissAs(t, AWAY, game, 0)

    expect(await readAs(t, AWAY, game)).toBe(1)
  })

  it('keeps one record per viewer per game, however often they dismiss', async () => {
    const { t, game } = await seedLiveGame()
    await strikeOut(t, game)
    await strikeOut(t, game)

    await dismissAs(t, AWAY, game, 0)
    await dismissAs(t, AWAY, game, 0)
    await dismissAs(t, AWAY, game, 1)

    expect(await rowsFor(t, game)).toHaveLength(1)
  })

  it('records one dismissal for an owner of both clubs', async () => {
    const { t, game } = await seedLiveGame({ hotseat: true })
    await strikeOut(t, game, HOME)

    await dismissAs(t, HOME, game, 0)

    expect(await readAs(t, HOME, game)).toBe(0)
    expect(await rowsFor(t, game)).toHaveLength(1)
  })

  it('accepts the deciding play of a final game', async () => {
    const { t, game } = await seedLiveGame()
    await strikeOut(t, game)
    await t.run((ctx) => ctx.db.patch(game, { status: 'final' }))

    await dismissAs(t, AWAY, game, 0)

    expect(await readAs(t, AWAY, game)).toBe(0)
  })
})

describe('dismissReveal — refusals', () => {
  it('refuses an at-bat the game has not resolved', async () => {
    const { t, game } = await seedLiveGame()
    await strikeOut(t, game)

    await expect(dismissAs(t, AWAY, game, 1)).rejects.toThrow()
    expect(await readAs(t, AWAY, game)).toBeNull()
  })

  it('refuses a caller who is not signed in', async () => {
    const { t, game } = await seedLiveGame()
    await strikeOut(t, game)

    await expect(
      t.mutation(api.revealDismissals.dismissReveal, { game, sequence: 0 }),
    ).rejects.toThrow('Not authenticated')
  })

  it('refuses a stranger exactly as it refuses a game that is not there', async () => {
    const { t, game } = await seedLiveGame()
    await strikeOut(t, game)

    const stranger = await refusalOf(dismissAs(t, STRANGER, game, 0))
    const missing = await refusalOf(dismissAs(t, AWAY, await vanishedGame(t, game), 0))

    expect(stranger).toBe(missing)
    expect(await rowsFor(t, game)).toHaveLength(0)
  })
})
