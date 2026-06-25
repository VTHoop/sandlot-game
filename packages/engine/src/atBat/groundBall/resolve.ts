import type { Band } from '../../rangeFinder/frontHalf'
import type { BaseState, RunnerId } from '../advance'
import { advanceGroundBall } from './advance'
import { eligibleGroundBallResults } from './eligibility'
import { selectGroundBallResult } from './partition'
import type { GroundBallResult } from './result'

export interface GroundBallInput {
  /** The folded 0–499 difference; must lie inside `gbBand`. */
  difference: number
  /** The matchup's elastic GB band, from `classify`. */
  gbBand: Band
  basesBefore: BaseState
  outsBefore: number
  batter: RunnerId
  /** Netted speed − awareness axis driving the DP-vs-FC split (clamped upstream). */
  speedDiff: number
}

export interface GroundBallResolution {
  result: GroundBallResult
  runsScored: number
  rbi: number
  outsAfter: number
  basesAfter: BaseState
}

/**
 * Resolve a ground ball into its sub-result and apply it: select the sub-band the
 * difference lands in (gated by base state + outs, sized by the speed axis), move
 * the runners, fold in the pre-state outs, and apply third-out run suppression.
 */
export function resolveGroundBall(input: GroundBallInput): GroundBallResolution {
  // Stub: implemented in the GREEN step.
  void advanceGroundBall
  void eligibleGroundBallResults
  void selectGroundBallResult
  throw new Error(`resolveGroundBall not implemented for difference ${input.difference}`)
}
