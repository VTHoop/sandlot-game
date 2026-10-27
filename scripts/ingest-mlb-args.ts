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
  const [flag, ...values] = rest
  if (flag !== '--season' || values.length > 1) {
    throw new Error(`unknown argument: ${rest.join(' ')}\n${USAGE}`)
  }
  const year = values.join('')
  if (!/^\d{4}$/.test(year)) throw new Error(`--season needs a four-digit year\n${USAGE}`)
  return { season: Number(year) }
}

function unexpected(stdout: string): Error {
  return new Error(`unexpected output from convex run:\n${stdout}`)
}

function requireCount(
  fields: ReadonlyMap<string, unknown>,
  key: keyof IngestReport,
  stdout: string,
) {
  const value = fields.get(key)
  if (typeof value !== 'number') throw unexpected(stdout)
  return value
}

function fieldsOf(stdout: string): ReadonlyMap<string, unknown> {
  let parsed: unknown
  try {
    parsed = JSON.parse(stdout)
  } catch {
    throw unexpected(stdout)
  }
  if (typeof parsed !== 'object' || parsed === null) throw unexpected(stdout)
  return new Map(Object.entries(parsed))
}

/** Read `convex run`'s stdout (JSON when piped) into an {@link IngestReport}. */
export function parseReport(stdout: string): IngestReport {
  const fields = fieldsOf(stdout)
  return {
    season: requireCount(fields, 'season', stdout),
    hitters: requireCount(fields, 'hitters', stdout),
    pitchers: requireCount(fields, 'pitchers', stdout),
  }
}

/** `Ingested 2026: 751 hitters, 868 pitchers.` */
export function reportLine({ season, hitters, pitchers }: IngestReport): string {
  return `Ingested ${season}: ${hitters} hitters, ${pitchers} pitchers.`
}
