import { v } from 'convex/values'
import { internal } from './_generated/api'
import { internalAction, internalMutation } from './_generated/server'
import { IngestError, IngestSource } from './mlbFields'
import { buildSeasonRows, latestCompletedSeason, unknownPositionIds } from './mlbStats'
import { mlbHitterRow, mlbPitcherRow } from './validators'

/**
 * MLB season ingest (SAN-25, ADR-0037). `run` fetches every source for one
 * season, validates all of it through `mlbStats`, and only then hands the rows to
 * `replaceSeason` — a single transaction. A source that fails, comes back empty or
 * lacks a field therefore throws before anything is written, and the season's
 * stored rows stay as they were.
 *
 * Internal on purpose: no client reads the raw rows (SAN-26 turns them into
 * `players`), and the weekly cron (SAN-28) calls `run` with the live season.
 */

const STATS_API = 'https://statsapi.mlb.com/api/v1'
const SAVANT_SPRINT_SPEED = 'https://baseballsavant.mlb.com/leaderboard/sprint_speed'

/** Comfortably above a season's players (~750 hitters, ~870 pitchers), so one page is all of them. */
const EVERYONE = '5000'

export interface IngestReport {
  season: number
  hitters: number
  pitchers: number
}

/** Long enough for a whole season's page; short enough to name the source that stalled. */
const REQUEST_TIMEOUT_MS = 60_000

enum StatsKind {
  Season = 'season',
  SeasonAdvanced = 'seasonAdvanced',
}

enum StatsGroup {
  Hitting = 'hitting',
  Pitching = 'pitching',
}

function failureOf(source: IngestSource, error: unknown): IngestError {
  if (error instanceof Error && error.name === 'TimeoutError') {
    return new IngestError(source, 'the request timed out')
  }
  const reason = error instanceof Error ? error.message : 'unknown error'
  return new IngestError(source, `the request failed (${reason})`)
}

async function fetchSource(source: IngestSource, url: URL): Promise<Response> {
  const response = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) }).catch(
    (error: unknown) => {
      throw failureOf(source, error)
    },
  )
  if (!response.ok) throw new IngestError(source, `HTTP ${response.status}`)
  return response
}

async function fetchJson(source: IngestSource, url: URL): Promise<unknown> {
  const response = await fetchSource(source, url)
  return response.json().catch(() => {
    throw new IngestError(source, 'the response is not JSON')
  })
}

async function fetchText(source: IngestSource, url: URL): Promise<string> {
  return (await fetchSource(source, url)).text()
}

function statsUrl(season: number, kind: StatsKind, group: StatsGroup): URL {
  const url = new URL(`${STATS_API}/stats`)
  url.search = new URLSearchParams({
    stats: kind,
    group,
    season: String(season),
    playerPool: 'ALL',
    sportIds: '1',
    limit: EVERYONE,
  }).toString()
  return url
}

function sprintSpeedUrl(season: number): URL {
  const url = new URL(SAVANT_SPRINT_SPEED)
  url.searchParams.set('year', String(season))
  url.searchParams.set('csv', 'true')
  return url
}

/** The unknown-position players' listed positions, or null when none needs a lookup. */
async function fetchProfiles(ids: number[]): Promise<unknown> {
  if (ids.length === 0) return null
  const url = new URL(`${STATS_API}/people`)
  url.searchParams.set('personIds', ids.join(','))
  return fetchJson(IngestSource.Profiles, url)
}

async function seasonToIngest(requested: number | undefined): Promise<number> {
  if (requested !== undefined) return requested
  const seasons = await fetchJson(
    IngestSource.Seasons,
    new URL(`${STATS_API}/seasons/all?sportId=1`),
  )
  return latestCompletedSeason(seasons, new Date())
}

/** Fetch every source for a season, validate it all, then replace the season's rows. */
export const run = internalAction({
  args: { season: v.optional(v.float64()) },
  handler: async (ctx, args): Promise<IngestReport> => {
    const season = await seasonToIngest(args.season)
    const [hitting, pitching, pitchingAdvanced, sprintCsv] = await Promise.all([
      fetchJson(IngestSource.Hitting, statsUrl(season, StatsKind.Season, StatsGroup.Hitting)),
      fetchJson(IngestSource.Pitching, statsUrl(season, StatsKind.Season, StatsGroup.Pitching)),
      fetchJson(
        IngestSource.PitchingAdvanced,
        statsUrl(season, StatsKind.SeasonAdvanced, StatsGroup.Pitching),
      ),
      fetchText(IngestSource.SprintSpeed, sprintSpeedUrl(season)),
    ])
    const profiles = await fetchProfiles(unknownPositionIds(hitting, pitching))

    const { hitters, pitchers } = buildSeasonRows({
      season,
      hitting,
      pitching,
      pitchingAdvanced,
      profiles,
      sprintCsv,
    })
    await ctx.runMutation(internal.ingest.replaceSeason, { season, hitters, pitchers })
    return { season, hitters: hitters.length, pitchers: pitchers.length }
  },
})

/** Replace one season's raw rows in a single transaction; other seasons are not read. */
export const replaceSeason = internalMutation({
  args: {
    season: v.float64(),
    hitters: v.array(mlbHitterRow),
    pitchers: v.array(mlbPitcherRow),
  },
  handler: async (ctx, { season, hitters, pitchers }): Promise<null> => {
    const stale = await ctx.db
      .query('mlbSeasonStats')
      .withIndex('by_season', (q) => q.eq('season', season))
      .collect()
    for (const row of stale) await ctx.db.delete(row._id)
    for (const row of [...hitters, ...pitchers]) await ctx.db.insert('mlbSeasonStats', row)
    return null
  },
})
