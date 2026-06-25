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

const scored = (runner: RunnerId | null): number => (runner ? 1 : 0)

/**
 * Double play: the batter and the lead forced runner are both out (+2). The lead
 * forced runner is the foremost runner in the force chain from home — runner on
 * 3rd is forced only with 1st & 2nd behind it, runner on 2nd only with 1st behind
 * it, runner on 1st always. Trailing forced runners advance into the vacated
 * bases; non-forced runners (e.g. a runner on 3rd with 2nd open) hold. The lead
 * runner's would-be run is the out, so a DP never scores (rules §2.13 force model).
 */
function doublePlay(b: BaseState): BaseState {
  if (b.second && b.third) return { first: null, second: b.first, third: b.second } // out at home
  if (b.second) return { first: null, second: b.first, third: null } // out at 3rd
  if (b.third) return { first: null, second: null, third: b.third } // out at 2nd, 3rd holds
  return { first: null, second: null, third: null } // out at 2nd, bases otherwise empty
}

/** Movement per sub-result (rules §2.9–2.15). Pure; builds fresh base literals. */
const MOVEMENT: Record<GroundBallResult, (b: BaseState, batter: RunnerId) => GroundBallAdvance> = {
  [GroundBallResult.GO]: (b) => ({ runsScored: 0, outsDelta: 1, basesAfter: { ...b } }),
  [GroundBallResult.GO_RA]: (b) => ({
    runsScored: scored(b.third),
    outsDelta: 1,
    basesAfter: { first: null, second: b.first, third: b.second },
  }),
  [GroundBallResult.FC]: (b, batter) => ({
    runsScored: 0,
    outsDelta: 1,
    basesAfter: { first: batter, second: null, third: b.third },
  }),
  [GroundBallResult.FC_2ND]: (b, batter) => ({
    runsScored: scored(b.third),
    outsDelta: 1,
    basesAfter: { first: batter, second: null, third: b.second },
  }),
  [GroundBallResult.FC_3RD]: (b, batter) => ({
    runsScored: scored(b.third),
    outsDelta: 1,
    basesAfter: { first: batter, second: b.first, third: null },
  }),
  [GroundBallResult.FC_HOME]: (b, batter) => ({
    runsScored: 0,
    outsDelta: 1,
    basesAfter: { first: batter, second: b.first, third: b.second },
  }),
  [GroundBallResult.DP]: (b) => ({ runsScored: 0, outsDelta: 2, basesAfter: doublePlay(b) }),
  [GroundBallResult.TP]: () => ({
    runsScored: 0,
    outsDelta: 3,
    basesAfter: { first: null, second: null, third: null },
  }),
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
  return MOVEMENT[result](bases, batter)
}
