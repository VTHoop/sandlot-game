import type { BaseState } from '../advance'
import { BuntResult } from './result'

/** Which sacrifice (by the lead runner's base) and what the top tail resolves to. */
export interface BuntEligibility {
  /** The sacrifice available given the lead runner, or null when the bases are empty. */
  sac: BuntResult.SAC_2ND | BuntResult.SAC_3RD | BuntResult.SAC_HOME | null
  /** What the 498–500 top tail resolves to: TP if possible, else DP, else a dud. */
  topTail: BuntResult.TP | BuntResult.DP | BuntResult.DUD
}

/**
 * Structural bunt eligibility (Rules §3.4 + the workbook Bunts tab):
 * - the sacrifice advances the **lead** runner — on 3rd → Sac Home, else on 2nd →
 *   Sac 3rd, else on 1st → Sac 2nd; bases empty → no sacrifice;
 * - the top tail is a triple play when a force is available at every base in play
 *   (runners on 1st **and** 2nd) with 0 outs; otherwise a double play when a force
 *   exists (a runner on 1st) with < 2 outs; otherwise a dud.
 */
export function buntEligibility(bases: BaseState, outs: number): BuntEligibility {
  const sac = bases.third
    ? BuntResult.SAC_HOME
    : bases.second
      ? BuntResult.SAC_3RD
      : bases.first
        ? BuntResult.SAC_2ND
        : null

  const tripleEligible = bases.first !== null && bases.second !== null && outs === 0
  const doubleEligible = bases.first !== null && outs < 2
  const topTail = tripleEligible ? BuntResult.TP : doubleEligible ? BuntResult.DP : BuntResult.DUD

  return { sac, topTail }
}
