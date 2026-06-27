import type { BaseState } from '../advance'
import { BuntResult } from './result'

/** Which sacrifice (by the lead runner's base) and what the top tail resolves to. */
export interface BuntEligibility {
  /** The sacrifice available given the lead runner, or null when the bases are empty. */
  sac: BuntResult.SAC_2ND | BuntResult.SAC_3RD | BuntResult.SAC_HOME | null
  /** What the 498–500 top tail resolves to: TP if possible, else DP, else a dud. */
  topTail: BuntResult.TP | BuntResult.DP | BuntResult.DUD
}

/** The sacrifice that advances the lead runner — on 3rd → Sac Home, else on 2nd →
 * Sac 3rd, else on 1st → Sac 2nd; bases empty → no sacrifice. */
function leadSacrifice(bases: BaseState): BuntEligibility['sac'] {
  if (bases.third) return BuntResult.SAC_HOME
  if (bases.second) return BuntResult.SAC_3RD
  if (bases.first) return BuntResult.SAC_2ND
  return null
}

/** The 498–500 top tail: a triple play with a force at every base in play (1st &
 * 2nd) and 0 outs; else a double play with a force (a runner on 1st) and < 2 outs;
 * else a dud. */
function topTailResult(bases: BaseState, outs: number): BuntEligibility['topTail'] {
  if (bases.first !== null && bases.second !== null && outs === 0) return BuntResult.TP
  if (bases.first !== null && outs < 2) return BuntResult.DP
  return BuntResult.DUD
}

/** Structural bunt eligibility (Rules §3.4 + the workbook Bunts tab). */
export function buntEligibility(bases: BaseState, outs: number): BuntEligibility {
  return { sac: leadSacrifice(bases), topTail: topTailResult(bases, outs) }
}
