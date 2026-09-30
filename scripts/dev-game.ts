// Mint a fresh dev game with you seated in it, and print its URL (SAN-66).
// Run from workspace root: pnpm dev:game [--hotseat] [--as user_…]
//
//   (default)   you hold the home club; the bot plays the away club
//   --hotseat   you hold both clubs
//   --as <sub>  seat this Clerk subject — only needed when the deployment has
//               more than one signed-in account
//
// A thin wrapper over `npx convex run seed:devGame` — the bootstrap and the club
// assignment happen server-side in one transaction (convex/seed.ts). Needs
// SANDLOT_DEV_SEED=true on the dev deployment, and you signed in to the app once.
import { spawnSync } from 'node:child_process'

// Where the app may be served locally, in the order they are tried: a plain
// `pnpm dev` (Vite's default, and what Playwright uses), then the agent
// preview's pinned port. The link names whichever is answering.
const APP_ORIGINS = ['http://localhost:5173', 'http://localhost:5183'] as const
const PROBE_TIMEOUT_MS = 500
const USAGE = 'usage: pnpm dev:game [--hotseat] [--as user_…]'

interface DevGameArgs {
  hotseat: boolean
  clerkSubject?: string
}

function parseArgs(argv: readonly string[]): DevGameArgs {
  const args: DevGameArgs = { hotseat: false }
  const rest = [...argv]
  while (rest.length > 0) {
    const flag = rest.shift()
    if (flag === '--') {
      // `pnpm dev:game -- --hotseat` forwards the separator too.
    } else if (flag === '--hotseat') {
      args.hotseat = true
    } else if (flag === '--as') {
      args.clerkSubject = rest.shift()
      if (!args.clerkSubject) throw new Error(`--as needs a Clerk subject\n${USAGE}`)
    } else {
      throw new Error(`unknown argument: ${flag}\n${USAGE}`)
    }
  }
  return args
}

/** `convex run` prints the returned id as a quoted literal, e.g. `'jd71…'`. */
function parseGameId(stdout: string): string {
  const id = stdout.trim().replace(/^['"]|['"]$/g, '')
  if (!/^[a-z0-9]+$/.test(id)) throw new Error(`unexpected output from convex run:\n${stdout}`)
  return id
}

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

  const game = parseGameId(run.stdout)
  const seating = args.hotseat ? 'you hold both clubs' : 'you are home; the bot is away'
  const origin = await servingOrigin()
  console.log(`New game (${seating}):\n  ${origin ?? APP_ORIGINS[0]}/game/${game}`)
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
