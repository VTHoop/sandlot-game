import type { BaseState, RunnerId } from '../advance'
import { GroundBallResult } from './result'

/**
 * The runner movement a ground-ball sub-result produces from the pre-state —
 * runs that physically cross the plate and the raw out delta, *before* third-out
 * run suppression (which depends on the pre-state out count and is applied by the
 * orchestration layer, not here). Identity-preserving: runner ids move between
 * bases exactly like the standard advancers in `../advance`.
 */
export interface GroundBallAdvance {
  runsScored: number
  outsDelta: number
  basesAfter: BaseState
}

/**
 * Apply a ground-ball sub-result's runner movement. Pure and out-count-agnostic:
 * the caller folds in `outsBefore` and suppresses runs on an inning-ending out.
 */
export function advanceGroundBall(
  result: GroundBallResult,
  bases: BaseState,
  batter: RunnerId,
): GroundBallAdvance {
  // Stub: implemented in the GREEN step. Throws so the RED test fails loudly
  // while still type-checking (the pre-commit typecheck gate stays satisfied).
  void bases
  void batter
  throw new Error(`advanceGroundBall not implemented for ${result}`)
}
