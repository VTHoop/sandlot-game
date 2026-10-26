// The command line and the printed report for `pnpm ingest:mlb` (SAN-25), kept
// apart from the script so they can be tested without running `convex`.
import type { FunctionArgs } from 'convex/server'
import type { internal } from '../convex/_generated/api'
import type { IngestReport } from '../convex/ingest'

export const USAGE = 'usage: pnpm ingest:mlb [--season YYYY]'

export type IngestArgs = FunctionArgs<typeof internal.ingest.run>

/** Parse the command line. No season means the latest completed regular season. */
export function parseArgs(argv: readonly string[]): IngestArgs {
  const rest = argv.filter((arg) => arg !== '--')
  if (rest.length === 0) return {}
  const [flag, year, ...extra] = rest
  if (flag !== '--season' || extra.length > 0) {
    throw new Error(`unknown argument: ${rest.join(' ')}\n${USAGE}`)
  }
  if (year === undefined || !/^\d{4}$/.test(year)) {
    throw new Error(`--season needs a four-digit year\n${USAGE}`)
  }
  return { season: Number(year) }
}

function unexpected(stdout: string): Error {
  return new Error(`unexpected output from convex run:\n${stdout}`)
}

/** Read `convex run`'s stdout (JSON when piped) into an {@link IngestReport}. */
export function parseReport(stdout: string): IngestReport {
  let parsed: unknown
  try {
    parsed = JSON.parse(stdout)
  } catch {
    throw unexpected(stdout)
  }
  if (typeof parsed !== 'object' || parsed === null) throw unexpected(stdout)
  const fields = new Map(Object.entries(parsed))
  const season = fields.get('season')
  const hitters = fields.get('hitters')
  const pitchers = fields.get('pitchers')
  if (typeof season !== 'number' || typeof hitters !== 'number' || typeof pitchers !== 'number') {
    throw unexpected(stdout)
  }
  return { season, hitters, pitchers }
}

/** `Ingested 2026: 751 hitters, 868 pitchers.` */
export function reportLine({ season, hitters, pitchers }: IngestReport): string {
  return `Ingested ${season}: ${hitters} hitters, ${pitchers} pitchers.`
}
