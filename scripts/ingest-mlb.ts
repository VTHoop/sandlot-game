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
import { runCommand } from './convex-run'
import { parseArgs, parseReport, reportLine } from './ingest-mlb-args'

runCommand('ingest:run', parseArgs, (stdout) => [reportLine(parseReport(stdout))])
