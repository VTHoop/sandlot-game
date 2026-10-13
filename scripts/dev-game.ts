// Mint a fresh dev game with real accounts seated in it, and print its URL
// (SAN-66, SAN-71). Run from workspace root:
//   pnpm dev:game [--home <name>] [--away <name>] [--force]
//
//   --home <name>  seat this account at home; may be left out when the deployment
//                  has one real account
//   --away <name>  seat this account away; left out, the bot plays away. Naming
//                  the --home account gives it both clubs
//   --force        re-seat an earlier game still in progress (otherwise refused)
//
// <name> is an account's display name, ignoring case: the whole name or its first
// word ("sam" finds "Sam Hooper"). The two seed clubs are taken back from whoever
// holds them, so earlier games of those clubs follow them to the new holders.
//
// A thin wrapper over `npx convex run seed:devGame` — the bootstrap and the club
// assignment happen server-side in one transaction (convex/seed.ts). Needs
// SANDLOT_DEV_SEED=true on the dev deployment, and each seated account signed in
// to the app once.
import { spawnSync } from 'node:child_process'
import { parseArgs, parseResult, reseatNote, seatingLine } from './devGameArgs'

// Where the app may be served locally, in the order they are tried: a plain
// `pnpm dev` (Vite's default, and what Playwright uses), then the agent
// preview's pinned port. The link names whichever is answering.
const APP_ORIGINS = ['http://localhost:5173', 'http://localhost:5183'] as const
const PROBE_TIMEOUT_MS = 500

/** Whether a dev server answers at `origin`: any response is yes, a refused
 * connection or a timeout is no. */
function isServing(origin: string): Promise<boolean> {
  return fetch(origin, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) }).then(
    () => true,
    () => false,
  )
}

/** The first origin with a dev server behind it, or null when none is up. */
async function servingOrigin(): Promise<string | null> {
  for (const origin of APP_ORIGINS) {
    if (await isServing(origin)) return origin
  }
  return null
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2))
  const run = spawnSync('npx', ['convex', 'run', 'seed:devGame', JSON.stringify(args)], {
    encoding: 'utf8',
    stdio: ['inherit', 'pipe', 'inherit'],
  })
  if (run.status !== 0) return run.status ?? 1

  const result = parseResult(run.stdout)
  const note = reseatNote(result)
  if (note) console.log(note)
  const origin = await servingOrigin()
  console.log(
    `New game (${seatingLine(result)}):\n  ${origin ?? APP_ORIGINS[0]}/game/${result.game}`,
  )
  if (!origin) {
    console.log('No dev server is answering; start one with `pnpm dev` (and `npx convex dev`).')
  }
  return 0
}

main().then(
  (code) => {
    process.exitCode = code
  },
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  },
)
