// Turn one ingested MLB season's raw rows into `players` (SAN-26). Run from
// workspace root, after `pnpm ingest:mlb`:
//   pnpm normalize:mlb --season YYYY
//
// A thin wrapper over `npx convex run normalize:run`: the regression, the cut
// tables and the writes all happen server-side (convex/normalize.ts). A season
// with no raw rows is refused. Re-running a season updates its players in place.
import { runCommand } from './convex-run'
import { parseArgs, parseReport, reportLines } from './normalize-mlb-args'

runCommand('normalize:run', parseArgs, (stdout) => reportLines(parseReport(stdout)))
