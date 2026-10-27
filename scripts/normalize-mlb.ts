// Turn one ingested MLB season's raw rows into `players` (SAN-26). Run from
// workspace root, after `pnpm ingest:mlb`:
//   pnpm normalize:mlb --season YYYY
//
// A thin wrapper over `npx convex run normalize:run`: the regression, the cut
// tables and the writes all happen server-side (convex/normalize.ts). A season
// with no raw rows is refused. Re-running a season updates its players in place.
import { spawnSync } from 'node:child_process'
import { parseArgs, parseReport, reportLines } from './normalize-mlb-args'

function main(): number {
  const args = parseArgs(process.argv.slice(2))
  const run = spawnSync('npx', ['convex', 'run', 'normalize:run', JSON.stringify(args)], {
    encoding: 'utf8',
    stdio: ['inherit', 'pipe', 'inherit'],
  })
  if (run.status !== 0) return run.status ?? 1

  for (const line of reportLines(parseReport(run.stdout))) console.log(line)
  return 0
}

try {
  process.exitCode = main()
} catch (error: unknown) {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
}
