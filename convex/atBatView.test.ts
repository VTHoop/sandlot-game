// @vitest-environment edge-runtime
/// <reference types="vite/client" />
import { Half } from '@sandlot/engine/game'
import { convexTest } from 'convex-test'
import { describe, expect, it } from 'vitest'
import { api } from './_generated/api'
import type { Id } from './_generated/dataModel'
import type { ResolvedAtBatView } from './duelContract'
import schema from './schema'

// convex-test discovers the function modules; exclude the test files themselves.
const modules = import.meta.glob(['./**/*.ts', '!./**/*.test.ts'])

const HOME = { subject: 'home-owner' }
const AWAY = { subject: 'away-owner' }
const STRANGER = { subject: 'stranger' }

const EMPTY_BASES = { first: null, second: null, third: null }

// Neutral blocks: the duel resolves off the difference alone, so the pairs below
// land in a known band whoever is at the plate.
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

/** An exact match on the ring is a home run (ADR-0016). */
const HOME_RUN = { pitch: 500, swing: 500 }
/** The widest reachable difference is the worst band for the batter. */
const STRIKEOUT = { pitch: 1, swing: 500 }
/** A number for the NEXT at-bat, outside everything else a view can carry, so
 * its absence can be asserted without a coincidental match. */
const NEXT_PITCH = 737

/**
 * A live game between two owners: AWAY bats first against HOME's pitcher.
 * STRANGER owns neither club.
 */
async function seedLiveGame() {
  const t = convexTest(schema, modules)
  const ids = await t.run(async (ctx) => {
    const homeUser = await ctx.db.insert('users', { clerkSubject: HOME.subject, displayName: 'H' })
    const awayUser = await ctx.db.insert('users', { clerkSubject: AWAY.subject, displayName: 'A' })
    await ctx.db.insert('users', { clerkSubject: STRANGER.subject, displayName: 'S' })
    const homeTeam = await ctx.db.insert('teams', { owner: homeUser, name: 'Ridgeview Rail' })
    const awayTeam = await ctx.db.insert('teams', { owner: awayUser, name: 'Harbor Kingfishers' })

    const awayLeadoff = await ctx.db.insert('players', { name: 'R. VANCE', ...HITTER })
    const awaySecond = await ctx.db.insert('players', { name: 'T. JULIEN', ...HITTER })
    const awayPitcher = await ctx.db.insert('players', { name: 'G. PIKE', ...ARM })
    const homeLeadoff = await ctx.db.insert('players', { name: 'J. WHITLOCK', ...HITTER })
    const homePitcher = await ctx.db.insert('players', { name: 'H. MARSH', ...ARM })

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
    return { game, awayLeadoff, awaySecond, awayPitcher, homeLeadoff, homePitcher }
  })
  await t.withIdentity(HOME).mutation(api.game.startGame, { game: ids.game })
  return { t, ...ids }
}

type Harness = Awaited<ReturnType<typeof seedLiveGame>>['t']

const read = (t: Harness, identity: { subject: string }, game: string) =>
  t.withIdentity(identity).query(api.atBatView.getLastAtBat, { game })

/** The view, or fail the test rather than the type system on a null. */
function resolved(view: ResolvedAtBatView | null): ResolvedAtBatView {
  if (!view) throw new Error('expected a resolved at-bat, got null')
  return view
}

/** Play one top-half at-bat: HOME pitches, AWAY swings. */
async function playTop(t: Harness, game: Id<'games'>, numbers: { pitch: number; swing: number }) {
  await t.withIdentity(HOME).mutation(api.atBat.commitPitch, { game, number: numbers.pitch })
  await t.withIdentity(AWAY).mutation(api.atBat.commitSwing, { game, number: numbers.swing })
}

/** Every number anywhere in a payload — shape-independent, so a secrecy assertion
 * survives the view growing a field. */
function numbersIn(value: unknown): number[] {
  if (typeof value === 'number') return [value]
  if (Array.isArray(value)) return value.flatMap(numbersIn)
  if (value !== null && typeof value === 'object') return Object.values(value).flatMap(numbersIn)
  return []
}

describe('getLastAtBat — the participant gate', () => {
  it('reads null until an at-bat has resolved', async () => {
    const { t, game } = await seedLiveGame()
    expect(await read(t, AWAY, game)).toBeNull()

    // One side on file is not a resolved at-bat.
    await t.withIdentity(HOME).mutation(api.atBat.commitPitch, { game, number: NEXT_PITCH })
    expect(await read(t, AWAY, game)).toBeNull()
  })

  it('reads null for a stranger, for no caller, and for a game that is not there', async () => {
    const { t, game } = await seedLiveGame()
    await playTop(t, game, HOME_RUN)

    expect(await read(t, STRANGER, game)).toBeNull()
    expect(await t.query(api.atBatView.getLastAtBat, { game })).toBeNull()

    const vanished = await t.run(async (ctx) => {
      const row = await ctx.db.get(game)
      if (!row) throw new Error('seed has no game')
      const { _id, _creationTime, ...fields } = row
      const id = await ctx.db.insert('games', fields)
      await ctx.db.delete(id)
      return id
    })
    expect(await read(t, HOME, vanished)).toBeNull()
  })
})

describe('getLastAtBat — an id that names no game', () => {
  it('reads a malformed id, or another table’s, as null rather than throwing', async () => {
    // Same rule as `getGame` (ADR-0025): every refusal is one null. Argument
    // validation throwing here would make this query answer differently from the
    // one beside it for the same bad id.
    const { t, game, awayLeadoff } = await seedLiveGame()
    await playTop(t, game, HOME_RUN)

    expect(await read(t, HOME, 'not-a-game-id')).toBeNull()
    expect(await read(t, HOME, awayLeadoff)).toBeNull()
  })
})

describe('getLastAtBat — the resolved at-bat', () => {
  it('describes the at-bat in full: who, both numbers, and what it did', async () => {
    const { t, game, awayLeadoff, homePitcher } = await seedLiveGame()
    await playTop(t, game, HOME_RUN)

    expect(await read(t, AWAY, game)).toEqual({
      sequence: 0,
      inning: 1,
      half: Half.Top,
      pitcher: { id: homePitcher, name: 'H. MARSH' },
      batter: { id: awayLeadoff, name: 'R. VANCE' },
      pitchNumber: HOME_RUN.pitch,
      batterNumber: HOME_RUN.swing,
      outcome: 'HR',
      groundBallResult: null,
      runsScored: 1,
      outsBefore: 0,
      outsAfter: 0,
      basesBefore: EMPTY_BASES,
      basesAfter: EMPTY_BASES,
      scoreBefore: { home: 0, away: 0 },
      hitsBefore: { home: 0, away: 0 },
      endedHalf: false,
      halfTotals: { runs: 1, hits: 1 },
    } satisfies ResolvedAtBatView)
  })

  it('hands both participants the same at-bat', async () => {
    const { t, game } = await seedLiveGame()
    await playTop(t, game, HOME_RUN)
    expect(await read(t, HOME, game)).toEqual(await read(t, AWAY, game))
  })

  it('counts the score and hits as they stood BEFORE the play', async () => {
    const { t, game, awaySecond } = await seedLiveGame()
    await playTop(t, game, HOME_RUN)
    await playTop(t, game, HOME_RUN)

    const view = resolved(await read(t, AWAY, game))
    expect(view.sequence).toBe(1)
    expect(view.batter).toEqual({ id: awaySecond, name: 'T. JULIEN' })
    // The first homer is on the board; the second — this at-bat — is not yet.
    expect(view.scoreBefore).toEqual({ home: 0, away: 1 })
    expect(view.hitsBefore).toEqual({ home: 0, away: 1 })
    expect(view.halfTotals).toEqual({ runs: 2, hits: 2 })
  })

  it('credits the home club once it bats the bottom half', async () => {
    const { t, game, homeLeadoff, awayPitcher } = await seedLiveGame()
    await playTop(t, game, HOME_RUN)
    await playTop(t, game, STRIKEOUT)
    await playTop(t, game, STRIKEOUT)
    await playTop(t, game, STRIKEOUT)
    // Bottom half: AWAY pitches, HOME swings.
    await t.withIdentity(AWAY).mutation(api.atBat.commitPitch, { game, number: HOME_RUN.pitch })
    await t.withIdentity(HOME).mutation(api.atBat.commitSwing, { game, number: HOME_RUN.swing })

    const view = resolved(await read(t, HOME, game))
    expect(view.half).toBe(Half.Bottom)
    expect(view.pitcher).toEqual({ id: awayPitcher, name: 'G. PIKE' })
    expect(view.batter).toEqual({ id: homeLeadoff, name: 'J. WHITLOCK' })
    expect(view.scoreBefore).toEqual({ home: 0, away: 1 })
    expect(view.hitsBefore).toEqual({ home: 0, away: 1 })
    // The half's own totals start over with the half.
    expect(view.halfTotals).toEqual({ runs: 1, hits: 1 })
  })
})

describe('getLastAtBat — the end of a half', () => {
  it('marks the at-bat whose third out ended the half, with the half’s totals', async () => {
    const { t, game } = await seedLiveGame()
    await playTop(t, game, HOME_RUN)
    await playTop(t, game, STRIKEOUT)
    await playTop(t, game, STRIKEOUT)
    expect(resolved(await read(t, AWAY, game)).endedHalf).toBe(false)

    await playTop(t, game, STRIKEOUT)
    const view = resolved(await read(t, AWAY, game))
    expect(view.outsAfter).toBe(3)
    expect(view.endedHalf).toBe(true)
    // Still the top half's at-bat, though the game has moved to the bottom.
    expect(view.half).toBe(Half.Top)
    expect(view.halfTotals).toEqual({ runs: 1, hits: 1 })
  })
})

describe('getLastAtBat — the vault holds', () => {
  it('keeps showing the last at-bat once a seat commits to the next, and never that number', async () => {
    // The bot commits the moment an at-bat opens (SAN-58). `getActiveDuel` stops
    // reporting the resolved at-bat at that point — which is why this query
    // exists — and the number now sitting in the vault must not ride along.
    const { t, game } = await seedLiveGame()
    await playTop(t, game, HOME_RUN)
    await t.withIdentity(HOME).mutation(api.atBat.commitPitch, { game, number: NEXT_PITCH })

    const view = resolved(await read(t, AWAY, game))
    expect(view.sequence).toBe(0)
    expect(view.pitchNumber).toBe(HOME_RUN.pitch)
    expect(numbersIn(view)).not.toContain(NEXT_PITCH)
  })
})
