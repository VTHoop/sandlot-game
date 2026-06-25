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

/** Occupancy bitmask `first<<2 | second<<1 | third` → structurally-possible
 * sub-results, in low→high band order. Keyed by a Map (not a plain object) to
 * keep the lookup off the dynamic object-member-access sink. A lone runner on
 * 2nd/3rd has no force and no eligible FC variant, so only `GO_RA` occurs. */
const ELIGIBLE_BY_OCCUPANCY = new Map<number, GroundBallResult[]>([
  [0b000, [GO]],
  [0b100, [GO_RA, FC, DP]], // 1st
  [0b010, [GO_RA]], // 2nd
  [0b001, [GO_RA]], // 3rd
  [0b110, [GO_RA, FC_2ND, FC_3RD, DP, TP]], // 1st & 2nd
  [0b101, [GO_RA, FC, FC_2ND, FC_HOME, DP]], // 1st & 3rd
  [0b011, [GO_RA, FC_HOME]], // 2nd & 3rd
  [0b111, [GO_RA, FC_2ND, FC_3RD, FC_HOME, DP, TP]], // loaded
])

export function eligibleGroundBallResults(bases: BaseState, outs: number): GroundBallResult[] {
  const occupancy =
    (bases.first ? 0b100 : 0) | (bases.second ? 0b010 : 0) | (bases.third ? 0b001 : 0)
  const eligible = ELIGIBLE_BY_OCCUPANCY.get(occupancy) ?? [GO_RA]
  // DP needs < 2 outs; TP needs 0 outs. Dropping them is the TP-tail collapse:
  // the next-lower result becomes the top slice and absorbs the freed tail.
  return eligible.filter((result) => !(result === DP && outs >= 2) && !(result === TP && outs >= 1))
}
