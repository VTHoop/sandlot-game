import type { BaseState } from '../advance'
import { GroundBallResult } from './result'

/**
 * The ground-ball sub-results that can occur in a given base/out state, in fixed
 * low→high order along the GB band (rules-doc order §2.10–2.15): the offense-
 * favorable `GO_RA` at the bottom, the fielder's-choice family in the middle, then
 * `DP`, then `TP` at the extreme top tail.
 *
 * Eligibility is purely structural:
 * - bases empty → `GO` only;
 * - `GO_RA` whenever a runner is aboard;
 * - each FC variant only where its lead-runner occupancy exists;
 * - `DP` needs a force (runner on 1st) and fewer than two outs;
 * - `TP` needs a force at every base in play (1st & 2nd, or loaded) and zero outs.
 *
 * The returned list is what the partition step distributes across `[GB.lo, GB.hi]`;
 * when outs make `TP`/`DP` ineligible, dropping them here is exactly the TP-tail
 * collapse — the next-lower result becomes the top slice and absorbs the tail.
 */
export function eligibleGroundBallResults(bases: BaseState, outs: number): GroundBallResult[] {
  // Stub: implemented in the GREEN step.
  void bases
  void outs
  return []
}
