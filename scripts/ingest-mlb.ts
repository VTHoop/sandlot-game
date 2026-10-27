// Ingest one MLB season's raw stats into the Convex deployment (SAN-25). Run from
// workspace root:
//   pnpm ingest:mlb [--season YYYY]
//
//   --season YYYY   the season to pull; left out, the most recent season whose
//                   regular season has ended
//
// A thin wrapper over `npx convex run ingest:run`: fetching, validating and
// storing all happen server-side (convex/ingest.ts). A source that fails or comes
// back incomplete aborts the run with an error naming it, and the season's
// stored rows are left as they were. Re-running a season replaces its rows.
import { spawnSync } from 'node:child_process'
import { parseArgs, parseReport, reportLine } from './ingest-mlb-args'

function main(): number {
  const args = parseArgs(process.argv.slice(2))
  const run = spawnSync('npx', ['convex', 'run', 'ingest:run', JSON.stringify(args)], {
    encoding: 'utf8',
    stdio: ['inherit', 'pipe', 'inherit'],
  })
  if (run.status !== 0) return run.status ?? 1

  console.log(reportLine(parseReport(run.stdout)))
  return 0
}

try {
  process.exitCode = main()
} catch (error: unknown) {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
}
