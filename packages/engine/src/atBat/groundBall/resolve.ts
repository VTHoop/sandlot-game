import type { Band } from '../../rangeFinder/frontHalf'
import type { BaseState, RunnerId } from '../advance'
import { OUTS_PER_INNING } from '../constants'
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
  const eligible = eligibleGroundBallResults(input.basesBefore, input.outsBefore)
  const result = selectGroundBallResult(
    { eligible, band: input.gbBand, speedDiff: input.speedDiff },
    input.difference,
  )
  const { runsScored, outsDelta, basesAfter } = advanceGroundBall(
    result,
    input.basesBefore,
    input.batter,
  )
  const outsAfter = input.outsBefore + outsDelta
  // Third-out run suppression (rules §2.9–2.15): every GB out is a force/fielding
  // out, so when the play records the inning-ending out, the runs that would have
  // crossed are wiped — GO_RA's batter out at 1st, a DP completing the inning, TP.
  const runs = outsAfter >= OUTS_PER_INNING ? 0 : runsScored
  return { result, runsScored: runs, rbi: runs, outsAfter, basesAfter }
}
