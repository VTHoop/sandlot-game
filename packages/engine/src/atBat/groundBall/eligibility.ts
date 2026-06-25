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
const { GO, GO_RA, FC, FC_2ND, FC_3RD, FC_HOME, DP, TP } = GroundBallResult

/** Occupancy → the sub-results that *structurally* occur, in low→high band order. */
function structurallyEligible(first: boolean, second: boolean, third: boolean): GroundBallResult[] {
  if (!first && !second && !third) return [GO]
  if (first && second && third) return [GO_RA, FC_2ND, FC_3RD, FC_HOME, DP, TP]
  if (first && second) return [GO_RA, FC_2ND, FC_3RD, DP, TP]
  if (first && third) return [GO_RA, FC, FC_2ND, FC_HOME, DP]
  if (second && third) return [GO_RA, FC_HOME]
  if (first) return [GO_RA, FC, DP]
  // runner on 2nd or 3rd alone — no force, no eligible FC variant.
  return [GO_RA]
}

export function eligibleGroundBallResults(bases: BaseState, outs: number): GroundBallResult[] {
  const eligible = structurallyEligible(
    bases.first !== null,
    bases.second !== null,
    bases.third !== null,
  )
  // DP needs < 2 outs; TP needs 0 outs. Dropping them is the TP-tail collapse:
  // the next-lower result becomes the top slice and absorbs the freed tail.
  return eligible.filter((result) => !(result === DP && outs >= 2) && !(result === TP && outs >= 1))
}
