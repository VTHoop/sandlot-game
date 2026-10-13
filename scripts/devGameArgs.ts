// The command line and the printed link for `pnpm dev:game` (SAN-71), kept apart
// from the script so they can be tested without running `convex`.

export const USAGE = 'usage: pnpm dev:game [--home <name>] [--away <name>] [--force]'

export interface DevGameArgs {
  home?: string
  away?: string
  force?: boolean
}

/** What `seed:devGame` answers: the game, who sits where, and what it re-seated. */
export interface DevGameResult {
  game: string
  home: string
  away: string
  reseated: number
}

/** The value after a flag, or a failure that shows the usage line. */
function nameAfter(flag: string, rest: string[]): string {
  const value = rest.shift()
  if (!value || value.startsWith('--')) throw new Error(`${flag} needs a name\n${USAGE}`)
  return value
}

/** Parse the command line. Unknown or removed flags fail with the usage line. */
export function parseArgs(argv: readonly string[]): DevGameArgs {
  const args: DevGameArgs = {}
  const rest = [...argv]
  while (rest.length > 0) {
    const flag = rest.shift()
    if (flag === '--') {
      // `pnpm dev:game -- --home sam` forwards the separator too.
    } else if (flag === '--home') {
      args.home = nameAfter(flag, rest)
    } else if (flag === '--away') {
      args.away = nameAfter(flag, rest)
    } else if (flag === '--force') {
      args.force = true
    } else {
      throw new Error(`unknown argument: ${flag}\n${USAGE}`)
    }
  }
  return args
}

/** `Sam (home) vs. Max (away)`, by full display name; `bot` when it plays. */
export function seatingLine(result: Pick<DevGameResult, 'home' | 'away'>): string {
  return `${result.home} (home) vs. ${result.away} (away)`
}

/** The note for earlier games the run re-seated, or null when it re-seated none. */
export function reseatNote(result: DevGameResult): string | null {
  if (result.reseated === 0) return null
  const games = result.reseated === 1 ? '1 earlier game' : `${result.reseated} earlier games`
  return `Re-seated ${games}: ${seatingLine(result)}.`
}

/** Read `convex run`'s stdout (JSON when piped) into a {@link DevGameResult}. */
export function parseResult(stdout: string): DevGameResult {
  const value: unknown = JSON.parse(stdout)
  if (
    typeof value === 'object' &&
    value !== null &&
    'game' in value &&
    typeof value.game === 'string' &&
    /^[a-z0-9]+$/.test(value.game) &&
    'home' in value &&
    typeof value.home === 'string' &&
    'away' in value &&
    typeof value.away === 'string' &&
    'reseated' in value &&
    typeof value.reseated === 'number'
  ) {
    return { game: value.game, home: value.home, away: value.away, reseated: value.reseated }
  }
  throw new Error(`unexpected output from convex run:\n${stdout}`)
}
