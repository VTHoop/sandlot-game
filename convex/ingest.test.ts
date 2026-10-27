// @vitest-environment edge-runtime
/// <reference types="vite/client" />

import type { Infer } from 'convex/values'
import { convexTest } from 'convex-test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { type api, internal } from './_generated/api'
import { IngestSource } from './mlbFields'
import schema from './schema'
import type { mlbHitterRow } from './validators'

/**
 * The MLB season ingest end to end (SAN-25, ADR-0037). Every source is a stubbed
 * `fetch` serving hand-built responses in the real APIs' shapes — fictional
 * players, invented numbers, never a captured response — and any URL the stub
 * does not know fails the test, so nothing here can reach the network.
 */

const modules = import.meta.glob(['./**/*.ts', '!./**/*.test.ts'])

/**
 * Compile-time guard for "no public query or mutation exposes the raw rows":
 * every function in `ingest` is internal, so the generated public `api` must not
 * carry the module at all. Make any of them public and `api` gains the key, this
 * type resolves to `never`, and `pnpm typecheck` fails.
 */
type IngestStaysInternal = 'ingest' extends keyof typeof api ? never : true
const _ingestStaysInternal: IngestStaysInternal = true
void _ingestStaysInternal

const STATS_API = 'https://statsapi.mlb.com/api/v1'
const SAVANT = 'https://baseballsavant.mlb.com/leaderboard/sprint_speed'

// --- the API shapes ---------------------------------------------------------

interface SplitInput {
  id: number
  name: string
  position?: string
  team?: string
  numTeams?: number
  stat: Record<string, number>
}

function split({ id, name, position, team = 'Harbor Gulls', numTeams = 1, stat }: SplitInput) {
  return {
    season: '2026',
    stat: { age: 27, gamesPlayed: 10, ...stat },
    team: { id: 1, name: team, link: '/api/v1/teams/1' },
    player: { id, fullName: name, link: `/api/v1/people/${id}` },
    numTeams,
    ...(position === undefined ? {} : { position: { abbreviation: position } }),
  }
}

const statsResponse = (splits: unknown[]) => ({ stats: [{ totalSplits: splits.length, splits }] })

const hit = (over: Partial<Record<string, number>> = {}) => ({
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
const pitch = (over: Partial<Record<string, number>> = {}) => ({
  battersFaced: 700,
  outs: 540,
  strikeOuts: 180,
  baseOnBalls: 55,
  homeRuns: 20,
  ...over,
})
const advanced = (over: Partial<Record<string, number>> = {}) => ({
  groundHits: 90,
  groundOuts: 210,
  ballsInPlay: 480,
  ...over,
})

const ADA = 900001 // hitter, one team, on the Savant leaderboard
const BO = 900002 // hitter traded mid-season, not on the leaderboard
const CY = 900003 // hitter with 1 PA, position X, profile says DH
const DEE = 900004 // hitter, position X, profile names none
const REN = 900005 // two-way: a hitting row and a pitching row
const PIA = 900006 // pitcher who batted once
const GUS = 900007 // pitcher traded mid-season
const HAL = 900008 // pitcher with 1 BF

interface World {
  seasons: unknown
  hitting: unknown[]
  pitching: unknown[]
  advanced: unknown[]
  people: unknown[]
  sprintCsv: string
  /** Sources that answer with this HTTP status instead of their body. */
  failing: Map<IngestSource, number>
  /** The source whose request runs out of time. */
  stalled?: IngestSource
}

const seasonRecord = (seasonId: string, regularSeasonEndDate: string) => ({
  seasonId,
  regularSeasonEndDate,
})

const defaultSeasons = () => ({
  seasons: [
    seasonRecord('2025', '2025-09-28'),
    seasonRecord('2026', '2026-09-27'),
    seasonRecord('2027', '2027-09-26'),
  ],
})

const defaultHitting = () => [
  split({ id: ADA, name: 'Ada Quill', position: 'SS', stat: hit() }),
  split({
    id: BO,
    name: 'Bo Marlow',
    position: 'CF',
    team: 'Prairie Owls',
    numTeams: 2,
    stat: hit({ plateAppearances: 480, hits: 120 }),
  }),
  split({
    id: CY,
    name: 'Cy Dunmore',
    position: 'X',
    stat: hit({ plateAppearances: 1, atBats: 1, hits: 0 }),
  }),
  split({ id: DEE, name: 'Dee Fenwick', position: 'X', stat: hit({ plateAppearances: 90 }) }),
  split({ id: REN, name: 'Ren Ashby', position: 'TWP', stat: hit({ plateAppearances: 550 }) }),
  split({
    id: PIA,
    name: 'Pia Voss',
    position: 'P',
    stat: hit({ plateAppearances: 1, atBats: 1, hits: 0 }),
  }),
]

const defaultPitching = () => [
  split({
    id: REN,
    name: 'Ren Ashby',
    position: 'TWP',
    stat: pitch({ battersFaced: 400, outs: 300 }),
  }),
  split({ id: PIA, name: 'Pia Voss', position: 'P', stat: pitch() }),
  split({
    id: GUS,
    name: 'Gus Hale',
    position: 'P',
    team: 'Prairie Owls',
    numTeams: 2,
    stat: pitch({ outs: 420 }),
  }),
  split({
    id: HAL,
    name: 'Hal Treadwell',
    position: 'P',
    stat: pitch({ battersFaced: 1, outs: 1, strikeOuts: 0, baseOnBalls: 0, homeRuns: 0 }),
  }),
]

const defaultAdvanced = () =>
  [REN, PIA, GUS, HAL].map((id) =>
    split({ id, name: `Pitcher ${id}`, position: 'P', stat: advanced() }),
  )

const defaultPeople = () => [
  { id: CY, fullName: 'Cy Dunmore', primaryPosition: { abbreviation: 'DH' } },
  { id: DEE, fullName: 'Dee Fenwick' },
]

const defaultSprintCsv = () =>
  '\uFEFF"last_name, first_name","player_id","team_id","team","position","age","competitive_runs","bolts","hp_to_1b","sprint_speed"\n' +
  `"Quill, Ada",${ADA},1,"HG","SS",27,"120","60","4.10","28.4"\n` +
  `"Ashby, Ren",${REN},1,"HG","DH",29,"80","30","4.20","27.1"\n`

function defaultWorld(): World {
  return {
    seasons: defaultSeasons(),
    hitting: defaultHitting(),
    pitching: defaultPitching(),
    advanced: defaultAdvanced(),
    people: defaultPeople(),
    sprintCsv: defaultSprintCsv(),
    failing: new Map(),
  }
}

// --- the stubbed network ----------------------------------------------------

let world: World
let fetched: URL[]
let signals: (AbortSignal | null | undefined)[]

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

interface Route {
  source: IngestSource
  matches: (url: URL) => boolean
  body: () => Response
}

const statsRequest = (kind: string, group: string) => (url: URL) =>
  url.pathname.endsWith('/stats') &&
  url.searchParams.get('stats') === kind &&
  url.searchParams.get('group') === group

/** Each source a request can be for, and what the world says it answers with. */
const ROUTES: readonly Route[] = [
  {
    source: IngestSource.Seasons,
    matches: (url) => url.pathname.endsWith('/seasons/all'),
    body: () => json(world.seasons),
  },
  {
    source: IngestSource.Hitting,
    matches: statsRequest('season', 'hitting'),
    body: () => json(statsResponse(world.hitting)),
  },
  {
    source: IngestSource.Pitching,
    matches: statsRequest('season', 'pitching'),
    body: () => json(statsResponse(world.pitching)),
  },
  {
    source: IngestSource.PitchingAdvanced,
    matches: statsRequest('seasonAdvanced', 'pitching'),
    body: () => json(statsResponse(world.advanced)),
  },
  {
    source: IngestSource.Profiles,
    matches: (url) => url.pathname.endsWith('/people'),
    body: () => json({ people: world.people }),
  },
  {
    source: IngestSource.SprintSpeed,
    matches: (url) => url.href.startsWith(SAVANT),
    body: () => new Response(world.sprintCsv),
  },
]

function route(url: URL): Route {
  const found = ROUTES.find((candidate) => candidate.matches(url))
  if (!found) throw new Error(`Unexpected fetch in a test: ${url.href}`)
  return found
}

beforeEach(() => {
  world = defaultWorld()
  fetched = []
  signals = []
  vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url)
    fetched.push(url)
    signals.push(init?.signal)
    const { source, body } = route(url)
    if (world.stalled === source) throw new DOMException('The operation timed out.', 'TimeoutError')
    const status = world.failing.get(source)
    return status === undefined ? body() : new Response('upstream trouble', { status })
  })
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-26T12:00:00Z'))
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

// --- the harness ------------------------------------------------------------

function harness() {
  return convexTest(schema, modules)
}
type Harness = ReturnType<typeof harness>

/** A season's stored rows without Convex's system fields, in a stable order. */
async function rowsOf(t: Harness, season?: number) {
  const docs = await t.run((ctx) => ctx.db.query('mlbSeasonStats').collect())
  return docs
    .filter((d) => season === undefined || d.season === season)
    .map(({ _id, _creationTime, ...row }) => row)
    .sort((a, b) => a.mlbId - b.mlbId || a.role.localeCompare(b.role))
}

async function rowFor(t: Harness, mlbId: number, role: 'hitter' | 'pitcher', season = 2026) {
  const row = (await rowsOf(t, season)).find((r) => r.mlbId === mlbId && r.role === role)
  if (!row) throw new Error(`No ${role} row for ${mlbId} in ${season}`)
  return row
}

const ingest = (t: Harness, season?: number) =>
  t.action(internal.ingest.run, season === undefined ? {} : { season })

// --- tests ------------------------------------------------------------------

describe('ingest.run — what a run does', () => {
  it('reports the season and the hitter and pitcher row counts', async () => {
    const t = harness()
    await expect(ingest(t, 2026)).resolves.toEqual({ season: 2026, hitters: 6, pitchers: 4 })
  })

  it('stores raw stat rows and writes no players rows', async () => {
    const t = harness()
    await ingest(t, 2026)
    expect((await rowsOf(t, 2026)).length).toBe(10)
    expect(await t.run((ctx) => ctx.db.query('players').collect())).toEqual([])
  })

  it('keeps everyone who appeared — a 1-PA hitter and a 1-BF pitcher included', async () => {
    const t = harness()
    await ingest(t, 2026)
    expect(await rowFor(t, CY, 'hitter')).toMatchObject({ plateAppearances: 1 })
    expect(await rowFor(t, HAL, 'pitcher')).toMatchObject({ battersFaced: 1 })
  })

  it("carries a hitter's identity, drivers, Speed-proxy counts and sprint record", async () => {
    const t = harness()
    await ingest(t, 2026)
    expect(await rowFor(t, ADA, 'hitter')).toEqual({
      role: 'hitter',
      mlbId: ADA,
      name: 'Ada Quill',
      season: 2026,
      team: 'Harbor Gulls',
      numTeams: 1,
      position: 'SS',
      ...hit(),
      sprintSpeed: 28.4,
      competitiveRuns: 120,
    })
  })

  it("carries a pitcher's drivers and its GB% inputs from the batted-ball breakdown", async () => {
    const t = harness()
    await ingest(t, 2026)
    expect(await rowFor(t, GUS, 'pitcher')).toEqual({
      role: 'pitcher',
      mlbId: GUS,
      name: 'Gus Hale',
      season: 2026,
      team: 'Prairie Owls',
      numTeams: 2,
      position: 'P',
      ...pitch({ outs: 420 }),
      ...advanced(),
    })
  })

  it('leaves the sprint fields off a hitter the leaderboard does not list', async () => {
    const t = harness()
    await ingest(t, 2026)
    const row = await rowFor(t, BO, 'hitter')
    expect(row).not.toHaveProperty('sprintSpeed')
    expect(row).not.toHaveProperty('competitiveRuns')
  })

  it('gives a player traded mid-season one row per role, with the full-season totals', async () => {
    const t = harness()
    await ingest(t, 2026)
    const bos = (await rowsOf(t, 2026)).filter((r) => r.mlbId === BO)
    expect(bos).toHaveLength(1)
    expect(bos[0]).toMatchObject({
      role: 'hitter',
      numTeams: 2,
      team: 'Prairie Owls',
      plateAppearances: 480,
      hits: 120,
    })
  })

  it('gives a two-way player both a hitting row and a pitching row', async () => {
    const t = harness()
    await ingest(t, 2026)
    const rens = (await rowsOf(t, 2026)).filter((r) => r.mlbId === REN)
    expect(rens.map((r) => r.role)).toEqual(['hitter', 'pitcher'])
  })

  it('replaces an unknown position with the profile one, and stores unknown when it names none', async () => {
    const t = harness()
    await ingest(t, 2026)
    expect((await rowFor(t, CY, 'hitter')).position).toBe('DH')
    expect((await rowFor(t, DEE, 'hitter')).position).toBe('unknown')
  })

  it('looks the unknown positions up in one batched call, and only those', async () => {
    const t = harness()
    await ingest(t, 2026)
    const lookups = fetched.filter((u) => u.pathname.endsWith('/people'))
    expect(lookups).toHaveLength(1)
    const asked = (lookups[0]?.searchParams.get('personIds') ?? '').split(',').map(Number).sort()
    expect(asked).toEqual([CY, DEE])
  })

  it('skips the profile lookup when no position is unknown', async () => {
    world.hitting = world.hitting.filter((_, i) => i !== 2 && i !== 3)
    const t = harness()
    await ingest(t, 2026)
    expect(fetched.some((u) => u.pathname.endsWith('/people'))).toBe(false)
  })

  it('stays inside the two public hosts', async () => {
    const t = harness()
    await ingest(t, 2026)
    const hosts = new Set(fetched.map((u) => u.host))
    expect(hosts).toEqual(new Set(['statsapi.mlb.com', 'baseballsavant.mlb.com']))
  })
})

describe('ingest.run — which season', () => {
  it('pulls the given season from every source', async () => {
    const t = harness()
    await ingest(t, 2025)
    const stats = fetched.filter(
      (u) => u.href.startsWith(STATS_API) && u.pathname.endsWith('/stats'),
    )
    expect(stats).toHaveLength(3)
    expect(stats.every((u) => u.searchParams.get('season') === '2025')).toBe(true)
    expect(fetched.find((u) => u.href.startsWith(SAVANT))?.searchParams.get('year')).toBe('2025')
    expect(fetched.some((u) => u.pathname.endsWith('/seasons/all'))).toBe(false)
  })

  it('asks for everyone: all players, MLB only, no qualification threshold', async () => {
    const t = harness()
    await ingest(t, 2026)
    for (const u of fetched.filter((x) => x.pathname.endsWith('/stats'))) {
      expect(u.searchParams.get('playerPool')).toBe('ALL')
      expect(u.searchParams.get('sportIds')).toBe('1')
      expect(Number(u.searchParams.get('limit'))).toBeGreaterThan(1500)
    }
  })

  it('defaults to the most recent completed regular season', async () => {
    const t = harness()
    const report = await ingest(t)
    expect(report.season).toBe(2026)
    expect((await rowsOf(t, 2026)).length).toBe(10)
  })

  it('defaults to the season before when this one is still being played', async () => {
    vi.setSystemTime(new Date('2026-06-01T12:00:00Z'))
    const t = harness()
    expect((await ingest(t)).season).toBe(2025)
  })
})

describe('ingest.run — re-running a season', () => {
  it('leaves one row per player per role, updated, and the other seasons untouched', async () => {
    const t = harness()
    await ingest(t, 2025)
    const before2025 = await rowsOf(t, 2025)

    await ingest(t, 2026)
    world.hitting[0] = split({
      id: ADA,
      name: 'Ada Quill',
      position: 'SS',
      stat: hit({ homeRuns: 31 }),
    })
    await ingest(t, 2026)

    const rows2026 = await rowsOf(t, 2026)
    expect(rows2026).toHaveLength(10)
    expect(new Set(rows2026.map((r) => `${r.mlbId}/${r.role}`)).size).toBe(10)
    expect(await rowFor(t, ADA, 'hitter')).toMatchObject({ homeRuns: 31 })
    expect(await rowsOf(t, 2025)).toEqual(before2025)
  })

  it('drops the row of a player the new run no longer lists', async () => {
    const t = harness()
    await ingest(t, 2026)
    world.pitching = world.pitching.filter((_, i) => i !== 3)
    await ingest(t, 2026)
    expect((await rowsOf(t, 2026)).some((r) => r.mlbId === HAL)).toBe(false)
  })
})

describe('ingest.run — a run that cannot finish', () => {
  /** Break one source three ways: it errors, it is empty, a record lacks a required field. */
  const FAILURES: ReadonlyArray<{
    source: IngestSource
    how: string
    season?: number
    break: (w: World) => void
  }> = [
    {
      source: IngestSource.Seasons,
      how: 'HTTP error',
      break: (w) => {
        w.failing.set(IngestSource.Seasons, 503)
      },
    },
    {
      source: IngestSource.Seasons,
      how: 'empty',
      break: (w) => {
        w.seasons = { seasons: [] }
      },
    },
    {
      source: IngestSource.Seasons,
      how: 'a record without its end date',
      break: (w) => {
        w.seasons = { seasons: [{ seasonId: '2026' }] }
      },
    },
    {
      source: IngestSource.Hitting,
      how: 'HTTP error',
      season: 2026,
      break: (w) => {
        w.failing.set(IngestSource.Hitting, 503)
      },
    },
    {
      source: IngestSource.Hitting,
      how: 'empty',
      season: 2026,
      break: (w) => {
        w.hitting = []
      },
    },
    {
      source: IngestSource.Hitting,
      how: 'a record without plate appearances',
      season: 2026,
      break: (w) => {
        w.hitting[0] = split({ id: ADA, name: 'Ada Quill', position: 'SS', stat: { atBats: 5 } })
      },
    },
    {
      source: IngestSource.Pitching,
      how: 'HTTP error',
      season: 2026,
      break: (w) => {
        w.failing.set(IngestSource.Pitching, 503)
      },
    },
    {
      source: IngestSource.Pitching,
      how: 'empty',
      season: 2026,
      break: (w) => {
        w.pitching = []
      },
    },
    {
      source: IngestSource.Pitching,
      how: 'a record without outs',
      season: 2026,
      break: (w) => {
        w.pitching[0] = split({
          id: REN,
          name: 'Ren Ashby',
          position: 'TWP',
          stat: { battersFaced: 5 },
        })
      },
    },
    {
      source: IngestSource.PitchingAdvanced,
      how: 'HTTP error',
      season: 2026,
      break: (w) => {
        w.failing.set(IngestSource.PitchingAdvanced, 503)
      },
    },
    {
      source: IngestSource.PitchingAdvanced,
      how: 'empty',
      season: 2026,
      break: (w) => {
        w.advanced = []
      },
    },
    {
      source: IngestSource.PitchingAdvanced,
      how: 'a record without balls in play',
      season: 2026,
      break: (w) => {
        w.advanced[0] = split({
          id: REN,
          name: 'Ren Ashby',
          position: 'P',
          stat: { groundHits: 3, groundOuts: 4 },
        })
      },
    },
    {
      source: IngestSource.Profiles,
      how: 'HTTP error',
      season: 2026,
      break: (w) => {
        w.failing.set(IngestSource.Profiles, 503)
      },
    },
    {
      source: IngestSource.Profiles,
      how: 'empty',
      season: 2026,
      break: (w) => {
        w.people = []
      },
    },
    {
      source: IngestSource.Profiles,
      how: 'a record without an id',
      season: 2026,
      break: (w) => {
        w.people = [{ primaryPosition: { abbreviation: 'DH' } }, { id: DEE }]
      },
    },
    {
      source: IngestSource.SprintSpeed,
      how: 'HTTP error',
      season: 2026,
      break: (w) => {
        w.failing.set(IngestSource.SprintSpeed, 503)
      },
    },
    {
      source: IngestSource.SprintSpeed,
      how: 'empty',
      season: 2026,
      break: (w) => {
        w.sprintCsv = ''
      },
    },
    {
      source: IngestSource.SprintSpeed,
      how: 'a record without a sprint speed',
      season: 2026,
      break: (w) => {
        w.sprintCsv = `"player_id","competitive_runs","sprint_speed"\n${ADA},"120",\n`
      },
    },
  ]

  it.each(
    FAILURES,
  )('aborts naming $source when $how, leaving the stored rows as they were', async (failure) => {
    const t = harness()
    await ingest(t, 2026)
    await ingest(t, 2025)
    const before = await rowsOf(t)
    failure.break(world)

    await expect(ingest(t, failure.season)).rejects.toThrow(`${failure.source}:`)

    expect(await rowsOf(t)).toEqual(before)
  })

  it('gives every request a deadline', async () => {
    const t = harness()
    await ingest(t)
    expect(signals).toHaveLength(fetched.length)
    expect(signals.every((signal) => signal instanceof AbortSignal)).toBe(true)
  })

  it.each([
    IngestSource.Seasons,
    IngestSource.Hitting,
    IngestSource.SprintSpeed,
  ])('aborts naming %s when its request runs out of time, leaving the stored rows', async (source) => {
    const t = harness()
    await ingest(t, 2026)
    const before = await rowsOf(t)
    world.stalled = source

    await expect(ingest(t, source === IngestSource.Seasons ? undefined : 2026)).rejects.toThrow(
      `${source}: the request timed out`,
    )
    expect(await rowsOf(t)).toEqual(before)
  })

  it('writes nothing to a season that had no rows yet', async () => {
    world.failing.set(IngestSource.Hitting, 503)
    const t = harness()
    await expect(ingest(t, 2026)).rejects.toThrow('hitting:')
    expect(await rowsOf(t)).toEqual([])
  })
})

describe('ingest.replaceSeason', () => {
  it('replaces only the named season', async () => {
    const t = harness()
    const old: Infer<typeof mlbHitterRow> = {
      role: 'hitter',
      mlbId: 1,
      name: 'Old Timer',
      season: 2026,
      team: 'Harbor Gulls',
      numTeams: 1,
      position: 'C',
      ...hit(),
    }
    await t.mutation(internal.ingest.replaceSeason, { season: 2026, hitters: [old], pitchers: [] })
    await t.mutation(internal.ingest.replaceSeason, {
      season: 2025,
      hitters: [{ ...old, season: 2025 }],
      pitchers: [],
    })
    await t.mutation(internal.ingest.replaceSeason, {
      season: 2026,
      hitters: [{ ...old, name: 'New Kid' }],
      pitchers: [],
    })

    expect((await rowsOf(t, 2026)).map((r) => r.name)).toEqual(['New Kid'])
    expect((await rowsOf(t, 2025)).map((r) => r.name)).toEqual(['Old Timer'])
  })
})
