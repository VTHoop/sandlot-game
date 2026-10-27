import type { Infer } from 'convex/values'
import type { HitterAttributes, PitcherAttributes, Score } from './attributes'
import type { MlbHitterRow, MlbPitcherRow } from './mlbStats'
import type { position } from './validators'

/**
 * A season's raw rows → the players they become, and the players they cannot
 * (SAN-26). Pure: `convex/normalize.ts` reads the rows and writes the result.
 */

export type Position = Infer<typeof position>

export interface SkippedPlayer {
  mlbId: number
  name: string
  reason: string
}

export type ScoreCounts = readonly [number, number, number, number, number]

export interface ScoreHistograms {
  power: ScoreCounts
  contact: ScoreCounts
  speed: ScoreCounts
  eye: ScoreCounts
  velocity: ScoreCounts
  movement: ScoreCounts
  awareness: ScoreCounts
  command: ScoreCounts
}

export type PlannedPlayer =
  | {
      mlbId: number
      name: string
      role: 'hitter'
      position: Position
      attributes: HitterAttributes
    }
  | {
      mlbId: number
      name: string
      role: 'pitcher'
      position: Position
      attributes: PitcherAttributes
    }

export interface SeasonPlan {
  players: PlannedPlayer[]
  skipped: SkippedPlayer[]
}

function notImplemented(): never {
  throw new Error('not implemented')
}

export function planSeason(
  _hitters: readonly MlbHitterRow[],
  _pitchers: readonly MlbPitcherRow[],
): SeasonPlan {
  return notImplemented()
}

export function tally(_scores: readonly Score[]): ScoreCounts {
  return notImplemented()
}
