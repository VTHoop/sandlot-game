import { v } from 'convex/values'
import { internal } from './_generated/api'
import { internalAction, internalMutation } from './_generated/server'
import { IngestError, type IngestSource } from './mlbFields'
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

async function fetchSource(source: IngestSource, url: string): Promise<Response> {
  const response = await fetch(url).catch((error: unknown) => {
    const reason = error instanceof Error ? error.message : 'unknown error'
    throw new IngestError(source, `the request failed (${reason})`)
  })
  if (!response.ok) throw new IngestError(source, `HTTP ${response.status}`)
  return response
}

async function fetchJson(source: IngestSource, url: string): Promise<unknown> {
  const response = await fetchSource(source, url)
  return response.json().catch(() => {
    throw new IngestError(source, 'the response is not JSON')
  })
}

async function fetchText(source: IngestSource, url: string): Promise<string> {
  return (await fetchSource(source, url)).text()
}

function statsUrl(season: number, kind: 'season' | 'seasonAdvanced', group: string): string {
  const query = new URLSearchParams({
    stats: kind,
    group,
    season: String(season),
    playerPool: 'ALL',
    sportIds: '1',
    limit: EVERYONE,
  })
  return `${STATS_API}/stats?${query}`
}

/** The unknown-position players' listed positions, or null when none needs a lookup. */
async function fetchProfiles(ids: number[]): Promise<unknown> {
  if (ids.length === 0) return null
  return fetchJson('profiles', `${STATS_API}/people?personIds=${ids.join(',')}`)
}

async function seasonToIngest(requested: number | undefined): Promise<number> {
  if (requested !== undefined) return requested
  const seasons = await fetchJson('seasons', `${STATS_API}/seasons/all?sportId=1`)
  return latestCompletedSeason(seasons, new Date())
}

/** Fetch every source for a season, validate it all, then replace the season's rows. */
export const run = internalAction({
  args: { season: v.optional(v.float64()) },
  handler: async (ctx, args): Promise<IngestReport> => {
    const season = await seasonToIngest(args.season)
    const [hitting, pitching, pitchingAdvanced, sprintCsv] = await Promise.all([
      fetchJson('hitting', statsUrl(season, 'season', 'hitting')),
      fetchJson('pitching', statsUrl(season, 'season', 'pitching')),
      fetchJson('pitching-advanced', statsUrl(season, 'seasonAdvanced', 'pitching')),
      fetchText('sprint-speed', `${SAVANT_SPRINT_SPEED}?year=${season}&csv=true`),
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
