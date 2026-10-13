// The command line and the printed link for `pnpm dev:game` (SAN-71), kept apart
// from the script so they can be tested without running `convex`.
import type { FunctionArgs } from 'convex/server'
import type { internal } from '../convex/_generated/api'
import type { DevGameResult as ServerResult } from '../convex/seed'

export const USAGE = 'usage: pnpm dev:game [--home NAME] [--away NAME] [--force]'

export type DevGameArgs = FunctionArgs<typeof internal.seed.devGame>

/** What `seed:devGame` answers — the server's own type, with the id as plain text. */
export type DevGameResult = Omit<ServerResult, 'game'> & { game: string }

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

/** The note for earlier games the run re-seated, or null when it moved none. */
export function reseatNote(result: DevGameResult): string | null {
  if (result.reseated === 0 && result.inProgress === 0) return null
  const parts = []
  if (result.reseated > 0) parts.push(countOf(result.reseated, 'earlier game'))
  if (result.inProgress > 0) parts.push(`${countOf(result.inProgress, 'game')} in progress`)
  return `Re-seated ${parts.join(' and ')}: ${seatingLine(result)}.`
}

function countOf(count: number, noun: string): string {
  return count === 1 ? `1 ${noun}` : `${count} ${noun}s`
}

type Fields = ReadonlyMap<string, unknown>

function unexpected(stdout: string): Error {
  return new Error(`unexpected output from convex run:\n${stdout}`)
}

function requireText(fields: Fields, key: keyof DevGameResult, stdout: string): string {
  const value = fields.get(key)
  if (typeof value !== 'string') throw unexpected(stdout)
  return value
}

function requireCount(fields: Fields, key: keyof DevGameResult, stdout: string): number {
  const value = fields.get(key)
  if (typeof value !== 'number') throw unexpected(stdout)
  return value
}

/** Read `convex run`'s stdout (JSON when piped) into a {@link DevGameResult}. */
export function parseResult(stdout: string): DevGameResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(stdout)
  } catch {
    throw unexpected(stdout)
  }
  if (typeof parsed !== 'object' || parsed === null) throw unexpected(stdout)
  const fields = new Map(Object.entries(parsed))
  const game = requireText(fields, 'game', stdout)
  if (!/^[a-z0-9]+$/.test(game)) throw unexpected(stdout)
  return {
    game,
    home: requireText(fields, 'home', stdout),
    away: requireText(fields, 'away', stdout),
    reseated: requireCount(fields, 'reseated', stdout),
    inProgress: requireCount(fields, 'inProgress', stdout),
  }
}
