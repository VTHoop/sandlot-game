// The command line and the printed report for `pnpm ingest:mlb` (SAN-25), kept
// apart from the script so they can be tested without running `convex`.
import type { FunctionArgs } from 'convex/server'
import type { internal } from '../convex/_generated/api'
import type { IngestReport } from '../convex/ingest'
import { optionalSeason, RunOutput } from './convex-run'

export const USAGE = 'usage: pnpm ingest:mlb [--season YYYY]'

export type IngestArgs = FunctionArgs<typeof internal.ingest.run>

/** Parse the command line. No season means the latest completed regular season. */
export const parseArgs = optionalSeason(USAGE)

/** Read `convex run`'s stdout (JSON when piped) into an {@link IngestReport}. */
export function parseReport(stdout: string): IngestReport {
  const output = RunOutput.parse<IngestReport>(stdout)
  return {
    season: output.number('season'),
    hitters: output.number('hitters'),
    pitchers: output.number('pitchers'),
  }
}

/** `Ingested 2026: 751 hitters, 868 pitchers.` */
export function reportLine({ season, hitters, pitchers }: IngestReport): string {
  return `Ingested ${season}: ${hitters} hitters, ${pitchers} pitchers.`
}
