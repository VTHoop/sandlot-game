// @vitest-environment edge-runtime
/// <reference types="vite/client" />

import { convexTest } from 'convex-test'
import { describe, expect, it } from 'vitest'
import { type api, internal } from './_generated/api'
import type { MlbHitterRow, MlbPitcherRow } from './mlbStats'
import schema from './schema'

/**
 * Season normalization end to end (SAN-26): raw `mlbSeasonStats` rows in,
 * `players` rows and a run report out. Every player is fictional and every number
 * invented — no real names or stats.
 */

const modules = import.meta.glob(['./**/*.ts', '!./**/*.test.ts'])

/**
 * Compile-time guard for "no public query or mutation runs it": the generated
 * public `api` must not carry the module at all.
 */
type NormalizeStaysInternal = 'normalize' extends keyof typeof api ? never : true
const _normalizeStaysInternal: NormalizeStaysInternal = true
void _normalizeStaysInternal

const SEASON = 2026

const hitter = (over: Partial<MlbHitterRow> = {}): MlbHitterRow => ({
  role: 'hitter',
  mlbId: 100,
  name: 'Ada Quill',
  season: SEASON,
  team: 'Harbor Gulls',
  numTeams: 1,
  position: 'SS',
  plateAppearances: 600,
  atBats: 540,
  hits: 150,
  doubles: 30,
  triples: 3,
  homeRuns: 25,
  strikeOuts: 120,
  baseOnBalls: 50,
  stolenBases: 12,
  caughtStealing: 4,
  ...over,
})

const pitcher = (over: Partial<MlbPitcherRow> = {}): MlbPitcherRow => ({
  role: 'pitcher',
  mlbId: 200,
  name: 'Gus Larkin',
  season: SEASON,
  team: 'Harbor Gulls',
  numTeams: 1,
  position: 'P',
  battersFaced: 700,
  outs: 540,
  strikeOuts: 180,
  baseOnBalls: 55,
  homeRuns: 20,
  groundHits: 90,
  groundOuts: 210,
  ballsInPlay: 480,
  ...over,
})

const ADA = 100 // shortstop
const BO = 101 // center fielder
const REN = 102 // two-way
const DEE = 103 // position unknown
const CY = 104 // position the engine has no slot for
const GUS = 200 // pitcher
const HAL = 201 // pitcher with no outs recorded
const PIA = 202 // pitcher who also batted

type Raw = MlbHitterRow | MlbPitcherRow

function setup(rows: readonly Raw[]) {
  const t = convexTest(schema, modules)
  const seeded = t.run(async (ctx) => {
    for (const row of rows) await ctx.db.insert('mlbSeasonStats', row)
  })
  return { t, seeded }
}

async function normalized(rows: readonly Raw[], season = SEASON) {
  const { t, seeded } = setup(rows)
  await seeded
  const report = await t.mutation(internal.normalize.run, { season })
  const players = await t.run((ctx) => ctx.db.query('players').collect())
  return { t, report, players }
}

/** Enough of a league that every rate has a pool, plus the players a test is about. */
const league = (...extra: Raw[]): Raw[] => [
  hitter({ mlbId: ADA }),
  pitcher({ mlbId: GUS }),
  ...extra,
]

describe('normalize.run', () => {
  it('refuses a season with no raw rows, and writes nothing', async () => {
    const { t, seeded } = setup([hitter({ season: 2025 }), pitcher({ season: 2025 })])
    await seeded
    await expect(t.mutation(internal.normalize.run, { season: SEASON })).rejects.toThrow(/2026/)
    expect(await t.run((ctx) => ctx.db.query('players').collect())).toEqual([])
  })

  it('creates source mlb rows with a null price, keyed by MLB id and role', async () => {
    const { players, report } = await normalized(league())
    expect(report.created).toBe(2)
    expect(players).toHaveLength(2)
    const ada = players.find((p) => p.mlbId === ADA)
    expect(ada).toMatchObject({
      name: 'Ada Quill',
      source: 'mlb',
      role: 'hitter',
      position: 'SS',
      price: null,
    })
    // The league is Ada alone, so her rates regress to themselves: ISO 111/540 = .206 is a 4.
    expect(ada?.attributes).toEqual({ power: 4, contact: 3, speed: 3, eye: 3 })
    expect(players.find((p) => p.mlbId === GUS)).toMatchObject({
      role: 'pitcher',
      position: 'P',
      price: null,
    })
  })

  describe('role follows the API position', () => {
    it('makes a P a pitcher and ignores the hitting row he also has', async () => {
      const { players } = await normalized(
        league(
          hitter({ mlbId: PIA, name: 'Pia Voss', position: 'P', plateAppearances: 3, atBats: 3 }),
          pitcher({ mlbId: PIA, name: 'Pia Voss' }),
        ),
      )
      expect(players.filter((p) => p.mlbId === PIA).map((p) => p.role)).toEqual(['pitcher'])
    })

    it('makes any other position a hitter and ignores the pitching row he also has', async () => {
      const { players } = await normalized(
        league(
          hitter({ mlbId: BO, name: 'Bo Marlow', position: 'CF' }),
          pitcher({ mlbId: BO, name: 'Bo Marlow', position: 'CF', battersFaced: 12, outs: 9 }),
        ),
      )
      expect(players.filter((p) => p.mlbId === BO).map((p) => [p.role, p.position])).toEqual([
        ['hitter', 'CF'],
      ])
    })

    it('makes a two-way player one hitter row (at DH) and one pitcher row (at P)', async () => {
      const { players, report } = await normalized(
        league(
          hitter({ mlbId: REN, name: 'Ren Ashby', position: 'TWP' }),
          pitcher({ mlbId: REN, name: 'Ren Ashby', position: 'TWP' }),
        ),
      )
      const ren = players.filter((p) => p.mlbId === REN)
      expect(ren.map((p) => [p.role, p.position]).sort()).toEqual([
        ['hitter', 'DH'],
        ['pitcher', 'P'],
      ])
      expect(report.created).toBe(4)
    })
  })

  describe('players it cannot place', () => {
    it('skips an unknown position and names the player in the report', async () => {
      const { players, report } = await normalized(
        league(hitter({ mlbId: DEE, name: 'Dee Fenwick', position: 'unknown' })),
      )
      expect(players.some((p) => p.mlbId === DEE)).toBe(false)
      expect(report.skipped).toEqual([
        { mlbId: DEE, name: 'Dee Fenwick', reason: expect.stringContaining('unknown') },
      ])
    })

    it('skips a position with no lineup slot rather than guessing one', async () => {
      const { players, report } = await normalized(
        league(hitter({ mlbId: CY, name: 'Cy Dunmore', position: 'OF' })),
      )
      expect(players.some((p) => p.mlbId === CY)).toBe(false)
      expect(report.skipped).toEqual([
        { mlbId: CY, name: 'Cy Dunmore', reason: expect.stringContaining('OF') },
      ])
    })

    it('skips a pitcher with no outs recorded, whose HR/9 is undefined', async () => {
      const { players, report } = await normalized(
        league(pitcher({ mlbId: HAL, name: 'Hal Treadwell', battersFaced: 2, outs: 0 })),
      )
      expect(players.some((p) => p.mlbId === HAL)).toBe(false)
      expect(report.skipped).toEqual([
        { mlbId: HAL, name: 'Hal Treadwell', reason: expect.stringContaining('outs') },
      ])
    })

    it('names a player once even when both of his rows are unplaceable', async () => {
      const { report } = await normalized(
        league(
          hitter({ mlbId: DEE, name: 'Dee Fenwick', position: 'unknown' }),
          pitcher({ mlbId: DEE, name: 'Dee Fenwick', position: 'unknown' }),
        ),
      )
      expect(report.skipped.map((s) => s.mlbId)).toEqual([DEE])
    })
  })

  describe('league rates', () => {
    const lonelyStrikeout = hitter({
      mlbId: BO,
      name: 'Bo Marlow',
      plateAppearances: 1,
      atBats: 1,
      hits: 0,
      doubles: 0,
      triples: 0,
      homeRuns: 0,
      strikeOuts: 1,
      baseOnBalls: 0,
    })
    const quiet = hitter({
      mlbId: ADA,
      plateAppearances: 1000,
      atBats: 900,
      hits: 200,
      doubles: 0,
      triples: 0,
      homeRuns: 0,
      strikeOuts: 0,
      baseOnBalls: 0,
    })

    it('come from every player in the raw data, including those it skips', async () => {
      // Pool of Bo and Ada alone: lg K% ≈ .001, so Bo's one strikeout regresses to
      // (1 + .001 × 60) / 61 ≈ .017 → Contact 5.
      const alone = await normalized([quiet, lonelyStrikeout, pitcher({ mlbId: GUS })])
      expect(alone.players.find((p) => p.mlbId === BO)?.attributes).toMatchObject({ contact: 5 })
      // Add a skipped player who strikes out half the time: lg K% ≈ .45, so the same
      // strikeout regresses to ≈ .46 → Contact 1.
      const skewed = await normalized([
        quiet,
        lonelyStrikeout,
        hitter({
          mlbId: DEE,
          name: 'Dee Fenwick',
          position: 'unknown',
          plateAppearances: 10000,
          atBats: 9000,
          strikeOuts: 5000,
        }),
        pitcher({ mlbId: GUS }),
      ])
      expect(skewed.players.find((p) => p.mlbId === BO)?.attributes).toMatchObject({ contact: 1 })
    })
  })

  describe('re-running a season', () => {
    it('updates name, position and attributes in place and creates only new players', async () => {
      const { t, report: first, players: before } = await normalized(league())
      expect(first).toMatchObject({ created: 2, updated: 0 })
      const adaId = before.find((p) => p.mlbId === ADA)?._id

      await t.run(async (ctx) => {
        const row = await ctx.db
          .query('mlbSeasonStats')
          .withIndex('by_season', (q) =>
            q.eq('season', SEASON).eq('role', 'hitter').eq('mlbId', ADA),
          )
          .unique()
        if (!row) throw new Error('fixture row missing')
        await ctx.db.patch(row._id, {
          name: 'Ada Quill-Rowe',
          position: '2B',
          homeRuns: 0,
          doubles: 0,
          triples: 0,
        })
        await ctx.db.insert(
          'mlbSeasonStats',
          hitter({ mlbId: BO, name: 'Bo Marlow', position: 'CF' }),
        )
      })
      const second = await t.mutation(internal.normalize.run, { season: SEASON })
      const after = await t.run((ctx) => ctx.db.query('players').collect())

      expect(second).toMatchObject({ created: 1, updated: 2 })
      expect(after).toHaveLength(3)
      const ada = after.find((p) => p.mlbId === ADA)
      expect(ada?._id).toBe(adaId)
      expect(ada).toMatchObject({ name: 'Ada Quill-Rowe', position: '2B' })
      expect(ada?.attributes).toMatchObject({ power: 1 })
    })

    it('leaves players absent from the raw data untouched', async () => {
      const { t } = await normalized(league())
      const [absent, custom] = await t.run(async (ctx) => {
        const attributes = { power: 5, contact: 5, speed: 5, eye: 5 } as const
        const absent = await ctx.db.insert('players', {
          name: 'Vic Absent',
          source: 'mlb',
          role: 'hitter',
          position: 'LF',
          price: 12,
          attributes,
          mlbId: 999,
        })
        const custom = await ctx.db.insert('players', {
          name: 'Home Brew',
          source: 'custom',
          role: 'hitter',
          position: 'DH',
          price: null,
          attributes,
        })
        return [absent, custom]
      })
      await t.mutation(internal.normalize.run, { season: SEASON })
      expect(await t.run((ctx) => ctx.db.get(absent))).toMatchObject({
        name: 'Vic Absent',
        price: 12,
        position: 'LF',
        attributes: { power: 5 },
      })
      expect(await t.run((ctx) => ctx.db.get(custom))).toMatchObject({
        name: 'Home Brew',
        source: 'custom',
      })
    })

    it('keeps a price already set on an existing player', async () => {
      const { t, players } = await normalized(league())
      const ada = players.find((p) => p.mlbId === ADA)
      if (!ada) throw new Error('fixture player missing')
      await t.run((ctx) => ctx.db.patch(ada._id, { price: 7 }))
      await t.mutation(internal.normalize.run, { season: SEASON })
      expect(await t.run((ctx) => ctx.db.get(ada._id))).toMatchObject({ price: 7 })
    })
  })

  describe('the run report', () => {
    it('gives the season, the counts, the skips and a 1–5 histogram per attribute', async () => {
      const fast = hitter({ mlbId: BO, name: 'Bo Marlow', sprintSpeed: 29.5, competitiveRuns: 40 })
      const { report } = await normalized(
        league(fast, hitter({ mlbId: DEE, name: 'Dee Fenwick', position: 'unknown' })),
      )
      expect(report).toMatchObject({ season: SEASON, created: 3, updated: 0 })
      expect(report.skipped).toHaveLength(1)
      // Ada has no sprint record (Speed 3); Bo's 29.5 ft/s over 40 runs is a 5.
      expect(report.scores.speed).toEqual([0, 0, 1, 0, 1])
      // Every pitcher's Awareness is 3.
      expect(report.scores.awareness).toEqual([0, 0, 1, 0, 0])
      for (const counts of [report.scores.power, report.scores.contact, report.scores.eye]) {
        expect(counts.reduce((a, b) => a + b, 0)).toBe(2)
      }
      for (const counts of [
        report.scores.velocity,
        report.scores.movement,
        report.scores.command,
      ]) {
        expect(counts.reduce((a, b) => a + b, 0)).toBe(1)
      }
    })
  })
})
