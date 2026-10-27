// The command line and the printed report for `pnpm normalize:mlb` (SAN-26), kept
// apart from the script so they can be tested without running `convex`.
import type { FunctionArgs } from 'convex/server'
import type { internal } from '../convex/_generated/api'
import type { NormalizeReport } from '../convex/normalize'
import type { ScoreCounts, ScoreHistograms, SkippedPlayer } from '../convex/seasonPlayers'

export const USAGE = 'usage: pnpm normalize:mlb --season YYYY'

export type NormalizeArgs = FunctionArgs<typeof internal.normalize.run>

/** Parse the command line. The season is required: normalizing is a deliberate act on stored rows. */
export function parseArgs(argv: readonly string[]): NormalizeArgs {
  const rest = argv.filter((arg) => arg !== '--')
  const [flag, ...values] = rest
  if (flag !== '--season' || values.length > 1) {
    throw new Error(
      `${rest.length === 0 ? 'missing' : 'unknown'} argument: ${rest.join(' ')}\n${USAGE}`,
    )
  }
  const year = values.join('')
  if (!/^\d{4}$/.test(year)) throw new Error(`--season needs a four-digit year\n${USAGE}`)
  return { season: Number(year) }
}

function unexpected(stdout: string): Error {
  return new Error(`unexpected output from convex run:\n${stdout}`)
}

type Fields = ReadonlyMap<string, unknown>

function fieldsOf(value: unknown, stdout: string): Fields {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw unexpected(stdout)
  return new Map(Object.entries(value))
}

function numberOf(fields: Fields, key: string, stdout: string): number {
  const value = fields.get(key)
  if (typeof value !== 'number') throw unexpected(stdout)
  return value
}

function textOf(fields: Fields, key: string, stdout: string): string {
  const value = fields.get(key)
  if (typeof value !== 'string') throw unexpected(stdout)
  return value
}

function listOf(fields: Fields, key: string, stdout: string): unknown[] {
  const value = fields.get(key)
  if (!Array.isArray(value)) throw unexpected(stdout)
  return value
}

function skippedOf(value: unknown, stdout: string): SkippedPlayer {
  const fields = fieldsOf(value, stdout)
  return {
    mlbId: numberOf(fields, 'mlbId', stdout),
    name: textOf(fields, 'name', stdout),
    reason: textOf(fields, 'reason', stdout),
  }
}

const hasFiveCounts = (counts: number[]): counts is [number, number, number, number, number] =>
  counts.length === 5

function countsOf(scores: Fields, key: string, stdout: string): ScoreCounts {
  const counts = listOf(scores, key, stdout).map((count) => {
    if (typeof count !== 'number') throw unexpected(stdout)
    return count
  })
  if (!hasFiveCounts(counts)) throw unexpected(stdout)
  return counts
}

function histogramsOf(scores: Fields, stdout: string): ScoreHistograms {
  return {
    power: countsOf(scores, 'power', stdout),
    contact: countsOf(scores, 'contact', stdout),
    speed: countsOf(scores, 'speed', stdout),
    eye: countsOf(scores, 'eye', stdout),
    velocity: countsOf(scores, 'velocity', stdout),
    movement: countsOf(scores, 'movement', stdout),
    awareness: countsOf(scores, 'awareness', stdout),
    command: countsOf(scores, 'command', stdout),
  }
}

/** Read `convex run`'s stdout (JSON when piped) into a {@link NormalizeReport}. */
export function parseReport(stdout: string): NormalizeReport {
  let parsed: unknown
  try {
    parsed = JSON.parse(stdout)
  } catch {
    throw unexpected(stdout)
  }
  const fields = fieldsOf(parsed, stdout)
  return {
    season: numberOf(fields, 'season', stdout),
    created: numberOf(fields, 'created', stdout),
    updated: numberOf(fields, 'updated', stdout),
    skipped: listOf(fields, 'skipped', stdout).map((entry) => skippedOf(entry, stdout)),
    scores: histogramsOf(fieldsOf(fields.get('scores'), stdout), stdout),
  }
}

const ATTRIBUTE_COLUMN = 10

function histogramLine(name: string, counts: ScoreCounts): string {
  return `  ${name.padEnd(ATTRIBUTE_COLUMN)}${counts.map((count) => String(count).padStart(6)).join('')}`
}

/** The run's summary, the skipped players by name, and each attribute's count at 1–5. */
export function reportLines({
  season,
  created,
  updated,
  skipped,
  scores,
}: NormalizeReport): string[] {
  return [
    `Normalized ${season}: ${created} created, ${updated} updated, ${skipped.length} skipped.`,
    ...skipped.map((s) => `  skipped ${s.name} (${s.mlbId}): ${s.reason}`),
    `Players per score:${'1 2 3 4 5'
      .split(' ')
      .map((n) => n.padStart(6))
      .join('')}`,
    histogramLine('power', scores.power),
    histogramLine('contact', scores.contact),
    histogramLine('speed', scores.speed),
    histogramLine('eye', scores.eye),
    histogramLine('velocity', scores.velocity),
    histogramLine('movement', scores.movement),
    histogramLine('awareness', scores.awareness),
    histogramLine('command', scores.command),
  ]
}
