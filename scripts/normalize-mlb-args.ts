// The command line and the printed report for `pnpm normalize:mlb` (SAN-26), kept
// apart from the script so they can be tested without running `convex`.
import type { NormalizeReport } from '../convex/normalize'
import type { ScoreCounts, ScoreHistograms, SkippedPlayer } from '../convex/seasonPlayers'
import { RunOutput, requiredSeason } from './convex-run'

export const USAGE = 'usage: pnpm normalize:mlb --season YYYY'

/** Parse the command line. The season is required: normalizing is a deliberate act on stored rows. */
export const parseArgs = requiredSeason(USAGE)

function readSkipped(item: RunOutput<SkippedPlayer>): SkippedPlayer {
  return { mlbId: item.number('mlbId'), name: item.text('name'), reason: item.text('reason') }
}

function readScores(scores: RunOutput<ScoreHistograms>): ScoreHistograms {
  return {
    power: scores.fiveNumbers('power'),
    contact: scores.fiveNumbers('contact'),
    speed: scores.fiveNumbers('speed'),
    eye: scores.fiveNumbers('eye'),
    velocity: scores.fiveNumbers('velocity'),
    movement: scores.fiveNumbers('movement'),
    awareness: scores.fiveNumbers('awareness'),
    command: scores.fiveNumbers('command'),
  }
}

/** Read `convex run`'s stdout (JSON when piped) into a {@link NormalizeReport}. */
export function parseReport(stdout: string): NormalizeReport {
  const output = RunOutput.parse<NormalizeReport>(stdout)
  return {
    season: output.number('season'),
    created: output.number('created'),
    updated: output.number('updated'),
    skipped: output.items<SkippedPlayer>('skipped').map(readSkipped),
    scores: readScores(output.child<ScoreHistograms>('scores')),
  }
}

const SCORE_COLUMNS = [1, 2, 3, 4, 5].map((score) => String(score).padStart(6)).join('')

function histogramLine([attribute, counts]: [string, ScoreCounts]): string {
  return `  ${attribute.padEnd(10)}${counts.map((count) => String(count).padStart(6)).join('')}`
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
    `Players per score:${SCORE_COLUMNS}`,
    ...Object.entries(scores).map(histogramLine),
  ]
}
