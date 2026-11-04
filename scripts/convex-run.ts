// What the `pnpm ingest:mlb` and `pnpm normalize:mlb` commands share: the
// `--season` flag, running an internal Convex function, and reading the JSON
// `convex run` prints. Kept in one place so the commands cannot drift apart.
import { spawnSync } from 'node:child_process'

type SeasonArgs = { season?: number }

/** The year after `--season`, nothing when the flag is absent; anything else fails with the usage. */
function seasonFrom(argv: readonly string[], usage: string): number | undefined {
  const rest = argv.filter((arg) => arg !== '--')
  if (rest.length === 0) return undefined
  const [flag, ...values] = rest
  if (flag !== '--season' || values.length > 1) {
    throw new Error(`unknown argument: ${rest.join(' ')}\n${usage}`)
  }
  const year = values.join('')
  if (!/^\d{4}$/.test(year)) throw new Error(`--season needs a four-digit year\n${usage}`)
  return Number(year)
}

/** A parser for a command whose season may be left out (the server then picks one). */
export const optionalSeason =
  (usage: string) =>
  (argv: readonly string[]): SeasonArgs => {
    const season = seasonFrom(argv, usage)
    return season === undefined ? {} : { season }
  }

/** A parser for a command that must be told the season. */
export const requiredSeason =
  (usage: string) =>
  (argv: readonly string[]): { season: number } => {
    const season = seasonFrom(argv, usage)
    if (season === undefined) throw new Error(`missing argument: --season\n${usage}`)
    return { season }
  }

/**
 * A command that wraps `npx convex run <function> <args>`: parse the command line,
 * run the function, print the report lines. Sets the process's exit code.
 */
export function runCommand(
  convexFunction: string,
  parseArgs: (argv: readonly string[]) => object,
  report: (stdout: string) => string[],
): void {
  try {
    process.exitCode = execute(convexFunction, parseArgs, report)
  } catch (error: unknown) {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  }
}

function execute(
  convexFunction: string,
  parseArgs: (argv: readonly string[]) => object,
  report: (stdout: string) => string[],
): number {
  const args = parseArgs(process.argv.slice(2))
  const run = spawnSync('npx', ['convex', 'run', convexFunction, JSON.stringify(args)], {
    encoding: 'utf8',
    stdio: ['inherit', 'pipe', 'inherit'],
  })
  if (run.status !== 0) return run.status ?? 1

  for (const line of report(run.stdout)) console.log(line)
  return 0
}

/**
 * The JSON `convex run` printed (it is JSON when piped), read field by field. Keys
 * are the report's own, so a misspelt one fails to compile; a missing or mistyped
 * field fails with the whole output shown.
 */
export class RunOutput<Shape extends object> {
  private constructor(
    private readonly fields: ReadonlyMap<string, unknown>,
    private readonly raw: string,
  ) {}

  /** Parse what the process printed. */
  static parse<S extends object>(stdout: string): RunOutput<S> {
    try {
      return RunOutput.of<S>(JSON.parse(stdout), stdout)
    } catch (error: unknown) {
      if (error instanceof SyntaxError) throw RunOutput.unexpected(stdout)
      throw error
    }
  }

  private static of<S extends object>(value: unknown, raw: string): RunOutput<S> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw RunOutput.unexpected(raw)
    }
    return new RunOutput<S>(new Map(Object.entries(value)), raw)
  }

  private static unexpected(raw: string): Error {
    return new Error(`unexpected output from convex run:\n${raw}`)
  }

  private field(key: keyof Shape): unknown {
    return this.fields.get(String(key))
  }

  number(key: keyof Shape): number {
    const value = this.field(key)
    if (typeof value !== 'number') throw RunOutput.unexpected(this.raw)
    return value
  }

  text(key: keyof Shape): string {
    const value = this.field(key)
    if (typeof value !== 'string') throw RunOutput.unexpected(this.raw)
    return value
  }

  /** A field holding an object, read the same way. */
  child<S extends object>(key: keyof Shape): RunOutput<S> {
    return RunOutput.of<S>(this.field(key), this.raw)
  }

  /** A field holding a list of objects, each read the same way. */
  items<S extends object>(key: keyof Shape): RunOutput<S>[] {
    const value = this.field(key)
    if (!Array.isArray(value)) throw RunOutput.unexpected(this.raw)
    return value.map((item) => RunOutput.of<S>(item, this.raw))
  }

  /** A field holding exactly five numbers. */
  fiveNumbers(key: keyof Shape): [number, number, number, number, number] {
    const value = this.field(key)
    const isFive = (list: unknown[]): list is [number, number, number, number, number] =>
      list.length === 5 && list.every((entry) => typeof entry === 'number')
    if (!Array.isArray(value) || !isFive(value)) throw RunOutput.unexpected(this.raw)
    return value
  }
}
