// @vitest-environment edge-runtime
/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { describe, expect, it } from 'vitest'
import { api } from './_generated/api'
import type { Id } from './_generated/dataModel'
import schema from './schema'

// convex-test discovers the function modules; exclude the test files themselves.
const modules = import.meta.glob(['./**/*.ts', '!./**/*.test.ts'])

const PITCHER = { subject: 'pitcher-subject' }
const BATTER = { subject: 'batter-subject' }
const STRANGER = { subject: 'stranger-subject' }

const EMPTY_BASES = { first: false, second: false, third: false }

/**
 * Seed a live game in the top half: the away team (owned by BATTER) is at bat,
 * the home team (owned by PITCHER) is in the field. STRANGER owns no team in
 * this game. Returns the harness + the game id.
 */
async function setupGame() {
  const t = convexTest(schema, modules)
  const gameId = await t.run(async (ctx) => {
    const pitcherUser = await ctx.db.insert('users', {
      clerkSubject: PITCHER.subject,
      displayName: 'Pitcher Owner',
    })
    const batterUser = await ctx.db.insert('users', {
      clerkSubject: BATTER.subject,
      displayName: 'Batter Owner',
    })
    await ctx.db.insert('users', { clerkSubject: STRANGER.subject, displayName: 'Stranger' })

    const homeTeam = await ctx.db.insert('teams', { owner: pitcherUser, name: 'Home' })
    const awayTeam = await ctx.db.insert('teams', { owner: batterUser, name: 'Away' })

    const hitter = await ctx.db.insert('players', {
      name: 'Slugger',
      source: 'custom',
      role: 'hitter',
      position: 'CF',
      price: null,
      attributes: { power: 3, contact: 3, speed: 3, eye: 3 },
    })
    const pitcher = await ctx.db.insert('players', {
      name: 'Ace',
      source: 'custom',
      role: 'pitcher',
      position: 'P',
      price: null,
      attributes: { velocity: 3, movement: 3, awareness: 3, command: 3 },
    })

    return await ctx.db.insert('games', {
      homeTeam,
      awayTeam,
      inning: 1,
      half: 'top',
      outs: 0,
      bases: EMPTY_BASES,
      homeScore: 0,
      awayScore: 0,
      status: 'live',
      currentBatter: hitter,
      currentPitcher: pitcher,
    })
  })
  return { t, gameId }
}

type Harness = Awaited<ReturnType<typeof setupGame>>['t']

const atBatRows = (t: Harness, game: Id<'games'>) =>
  t.run((ctx) =>
    ctx.db
      .query('atBats')
      .withIndex('by_game', (q) => q.eq('game', game))
      .collect(),
  )

const commitmentRows = (t: Harness, game: Id<'games'>) =>
  t.run((ctx) =>
    ctx.db
      .query('duelCommitments')
      .withIndex('by_game', (q) => q.eq('game', game))
      .collect(),
  )

describe('secret at-bat round-trip', () => {
  it('resolves an exact-match duel into exactly one complete at_bats row', async () => {
    const { t, gameId } = await setupGame()
    await t.withIdentity(PITCHER).mutation(api.atBat.commitPitch, { game: gameId, number: 500 })
    await t.withIdentity(BATTER).mutation(api.atBat.commitSwing, { game: gameId, number: 500 })

    const rows = await atBatRows(t, gameId)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      sequence: 0,
      outcome: 'HR',
      pitchNumber: 500,
      batterNumber: 500,
      runsScored: 1,
      rbi: 1,
      outsBefore: 0,
      outsAfter: 0,
      basesBefore: EMPTY_BASES,
      basesAfter: EMPTY_BASES,
      inning: 1,
      half: 'top',
    })
    expect(rows[0].createdAt).toBeTypeOf('number')
  })

  describe('secrecy contract', () => {
    it('does not reveal the pitch to the batting-team owner before the swing locks', async () => {
      const { t, gameId } = await setupGame()
      await t.withIdentity(PITCHER).mutation(api.atBat.commitPitch, { game: gameId, number: 742 })

      const view = await t.withIdentity(BATTER).query(api.atBat.getActiveDuel, { game: gameId })
      expect(view?.status).toBe('awaiting_opponent')
      expect(view?.pitchCommitted).toBe(true)
      expect(view?.swingCommitted).toBe(false)
      expect(view).not.toHaveProperty('pitchNumber')
      expect(JSON.stringify(view)).not.toContain('742')
    })

    it('does not reveal the swing to the pitching-team owner before the pitch locks', async () => {
      const { t, gameId } = await setupGame()
      await t.withIdentity(BATTER).mutation(api.atBat.commitSwing, { game: gameId, number: 742 })

      const view = await t.withIdentity(PITCHER).query(api.atBat.getActiveDuel, { game: gameId })
      expect(view?.status).toBe('awaiting_opponent')
      expect(view?.swingCommitted).toBe(true)
      expect(view?.pitchCommitted).toBe(false)
      expect(view).not.toHaveProperty('batterNumber')
      expect(JSON.stringify(view)).not.toContain('742')
    })

    it('reveals neither number to a non-participant at any stage', async () => {
      const { t, gameId } = await setupGame()
      await t.withIdentity(PITCHER).mutation(api.atBat.commitPitch, { game: gameId, number: 742 })
      expect(
        await t.withIdentity(STRANGER).query(api.atBat.getActiveDuel, { game: gameId }),
      ).toBeNull()

      await t.withIdentity(BATTER).mutation(api.atBat.commitSwing, { game: gameId, number: 123 })
      expect(
        await t.withIdentity(STRANGER).query(api.atBat.getActiveDuel, { game: gameId }),
      ).toBeNull()
    })

    it('reveals both numbers to both participants after the swing locks', async () => {
      const { t, gameId } = await setupGame()
      await t.withIdentity(PITCHER).mutation(api.atBat.commitPitch, { game: gameId, number: 742 })
      await t.withIdentity(BATTER).mutation(api.atBat.commitSwing, { game: gameId, number: 123 })

      for (const participant of [PITCHER, BATTER]) {
        const view = await t
          .withIdentity(participant)
          .query(api.atBat.getActiveDuel, { game: gameId })
        expect(view?.status).toBe('resolved')
        expect(view?.pitchNumber).toBe(742)
        expect(view?.batterNumber).toBe(123)
        expect(view?.outcome).toBeTypeOf('string')
      }
    })
  })

  describe('authentication & authorization', () => {
    it('rejects an unauthenticated pitch and writes nothing', async () => {
      const { t, gameId } = await setupGame()
      await expect(
        t.mutation(api.atBat.commitPitch, { game: gameId, number: 500 }),
      ).rejects.toThrow()
      expect(await commitmentRows(t, gameId)).toHaveLength(0)
    })

    it('rejects a pitch from someone who is not the pitching-team owner', async () => {
      const { t, gameId } = await setupGame()
      await expect(
        t.withIdentity(BATTER).mutation(api.atBat.commitPitch, { game: gameId, number: 500 }),
      ).rejects.toThrow()
      expect(await commitmentRows(t, gameId)).toHaveLength(0)
    })

    it('rejects an unauthenticated swing', async () => {
      const { t, gameId } = await setupGame()
      await t.withIdentity(PITCHER).mutation(api.atBat.commitPitch, { game: gameId, number: 500 })
      await expect(
        t.mutation(api.atBat.commitSwing, { game: gameId, number: 500 }),
      ).rejects.toThrow()
    })

    it('rejects a swing from someone who is not the batting-team owner', async () => {
      const { t, gameId } = await setupGame()
      await t.withIdentity(PITCHER).mutation(api.atBat.commitPitch, { game: gameId, number: 500 })
      await expect(
        t.withIdentity(PITCHER).mutation(api.atBat.commitSwing, { game: gameId, number: 500 }),
      ).rejects.toThrow()
    })
  })

  describe('input validation (integer 1–999)', () => {
    it('rejects out-of-range and non-integer pitch numbers', async () => {
      const { t, gameId } = await setupGame()
      for (const bad of [0, 1000, 1.5, -3]) {
        await expect(
          t.withIdentity(PITCHER).mutation(api.atBat.commitPitch, { game: gameId, number: bad }),
        ).rejects.toThrow()
      }
      expect(await commitmentRows(t, gameId)).toHaveLength(0)
    })

    it('rejects a missing pitch number at the validator boundary', async () => {
      const { t, gameId } = await setupGame()
      await expect(
        // @ts-expect-error — `number` is required; omitting it must be rejected.
        t.withIdentity(PITCHER).mutation(api.atBat.commitPitch, { game: gameId }),
      ).rejects.toThrow()
    })

    it('rejects out-of-range and non-integer swing numbers', async () => {
      const { t, gameId } = await setupGame()
      await t.withIdentity(PITCHER).mutation(api.atBat.commitPitch, { game: gameId, number: 500 })
      for (const bad of [0, 1000, 2.5]) {
        await expect(
          t.withIdentity(BATTER).mutation(api.atBat.commitSwing, { game: gameId, number: bad }),
        ).rejects.toThrow()
      }
    })

    it('accepts the inclusive boundary values 1 and 999 on both mutations', async () => {
      const { t, gameId } = await setupGame()
      await t.withIdentity(PITCHER).mutation(api.atBat.commitPitch, { game: gameId, number: 1 })
      await t.withIdentity(BATTER).mutation(api.atBat.commitSwing, { game: gameId, number: 999 })

      const rows = await atBatRows(t, gameId)
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({ pitchNumber: 1, batterNumber: 999 })
    })
  })

  describe('order-independent commits & idempotency (ADR-0014)', () => {
    it('resolves when the swing is committed first, then the pitch', async () => {
      const { t, gameId } = await setupGame()
      // No pitch on file yet — the batter may still lock.
      await t.withIdentity(BATTER).mutation(api.atBat.commitSwing, { game: gameId, number: 500 })
      expect(await atBatRows(t, gameId)).toHaveLength(0) // nothing resolves on one half

      await t.withIdentity(PITCHER).mutation(api.atBat.commitPitch, { game: gameId, number: 500 })
      const rows = await atBatRows(t, gameId)
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({ outcome: 'HR', pitchNumber: 500, batterNumber: 500 })
    })

    it('rejects a second pitch for the same at-bat (locked on submit)', async () => {
      const { t, gameId } = await setupGame()
      await t.withIdentity(PITCHER).mutation(api.atBat.commitPitch, { game: gameId, number: 500 })
      await expect(
        t.withIdentity(PITCHER).mutation(api.atBat.commitPitch, { game: gameId, number: 600 }),
      ).rejects.toThrow()
      const rows = await commitmentRows(t, gameId)
      expect(rows).toHaveLength(1)
      expect(rows[0].number).toBe(500)
    })

    it('rejects a second swing for the same at-bat (locked on submit)', async () => {
      const { t, gameId } = await setupGame()
      await t.withIdentity(BATTER).mutation(api.atBat.commitSwing, { game: gameId, number: 500 })
      await expect(
        t.withIdentity(BATTER).mutation(api.atBat.commitSwing, { game: gameId, number: 600 }),
      ).rejects.toThrow()
      const rows = await commitmentRows(t, gameId)
      expect(rows).toHaveLength(1)
      expect(rows[0].number).toBe(500)
    })

    it('appends exactly one row per duel and never re-resolves it', async () => {
      const { t, gameId } = await setupGame()
      await t.withIdentity(PITCHER).mutation(api.atBat.commitPitch, { game: gameId, number: 500 })
      await t.withIdentity(BATTER).mutation(api.atBat.commitSwing, { game: gameId, number: 500 })

      const before = await atBatRows(t, gameId)
      expect(before).toHaveLength(1)

      // The resolved sequence is sealed: the same side cannot reach back and
      // re-resolve it (its number now addresses the next at-bat), so the
      // resolved row is never duplicated or mutated.
      await t.withIdentity(BATTER).mutation(api.atBat.commitSwing, { game: gameId, number: 600 })
      const after = await atBatRows(t, gameId)
      expect(after).toHaveLength(1)
      expect(after[0]).toMatchObject({ pitchNumber: 500, batterNumber: 500, sequence: 0 })
    })
  })
})
