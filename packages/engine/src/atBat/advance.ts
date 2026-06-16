import type { OutcomeBandKey } from '../outcomes'

/** Base occupancy snapshot. */
export interface BaseState {
  first: boolean
  second: boolean
  third: boolean
}

/** The post-state an outcome produces from the pre-state. */
export interface OutcomeApplication {
  runsScored: number
  rbi: number
  basesAfter: BaseState
  outsAfter: number
}

/** Apply a resolved outcome to the base/out state (standard one-base advancement). */
export function applyOutcome(
  _outcome: OutcomeBandKey,
  _basesBefore: BaseState,
  _outsBefore: number,
): OutcomeApplication {
  throw new Error('not implemented')
}
