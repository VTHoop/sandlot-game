import type { AttributeDiff } from '../../tables/accessor'
import type { BaseState } from '../advance'
import { buntEligibility } from './eligibility'
import { BuntResult } from './result'

/**
 * Partition the folded 0–499 space into bunt sub-results (SAN-17, Rules §3.4 + the
 * workbook Bunts tab). Fixed tails frame an elastic middle:
 *   - `[0, 3]` → butcher boy (the "0–3 difference" bottom tail);
 *   - `[497, 499]` → the "498–500" top tail: triple play / double play / dud by
 *     eligibility;
 *   - `[4, 496]` → bunt-for-hit (batter-favorable, width by Cnt-vs-Mov) → the
 *     applicable sacrifice (width by Spe-vs-Awa) → dud (the remainder).
 * Best→worst for the batter runs low→high, so the difference orders the families
 * exactly like the RangeFinder band stack. Deterministic; no RNG.
 *
 * Tail mapping: the rules speak of a 0–500 difference, but the engine folds onto
 * 0–499 (ring of 999, `fold.ts`), so there is no literal 1:1 correspondence — the
 * GB triple play (rules "497–500") is likewise a *structural* top tail, not literal
 * values (ADR-0019/ADR-0006: re-derive structurally, never transcribe). These tails
 * preserve the rules' value-COUNT at the extremes of the folded range: "0–3" (4
 * values) → `[0, 3]`; "498–500" (3 values) → the top 3, `[497, 499]`. The exact
 * one-number width of the top tail is a re-derivation choice, not an off-by-one.
 *
 * Provenance: the bunt-for-hit and sac widths are structurally re-derived for this
 * engine, NOT transcribed from the reference calculator's Bunts tab (ADR-0006);
 * the per-differential widths are tunable seeds behind the injectable accessor.
 */

/** Inclusive top of the butcher-boy bottom tail (the folded analogue of "0–3"). */
const BUTCHER_BOY_HI = 3
/** Inclusive bottom of the triple/double-play top tail (the folded top-3 of "498–500"). */
const TOP_TAIL_LO = 497
/** The elastic middle band, between the two fixed tails. */
const MIDDLE_LO = BUTCHER_BOY_HI + 1
const MIDDLE_HI = TOP_TAIL_LO - 1
const MIDDLE_WIDTH = MIDDLE_HI - MIDDLE_LO + 1

/** Re-derived bunt-for-hit width by Cnt-vs-Mov differential, indexed by diff + 5. */
const BUNT_HIT_WIDTH_BY_CNT_MOV = [10, 16, 22, 28, 34, 40, 46, 52, 58, 64, 70] as const
/** Re-derived successful-sacrifice width by Spe-vs-Awa differential, indexed by diff + 5. */
const SAC_WIDTH_BY_SPE_AWA = [180, 200, 220, 240, 260, 280, 300, 320, 340, 360, 380] as const

/** Injectable so frozen test tables pin exact boundaries (SAN-15 retune-proof). */
export interface BuntAccessors {
  buntHitWidth(contactMovDiff: AttributeDiff): number
  sacWidth(speedAwaDiff: AttributeDiff): number
}

/** Exported so the gitignored parity lane can validate the live widths. */
export const liveBuntAccessors: BuntAccessors = {
  buntHitWidth: (contactMovDiff) => BUNT_HIT_WIDTH_BY_CNT_MOV[contactMovDiff + 5],
  sacWidth: (speedAwaDiff) => SAC_WIDTH_BY_SPE_AWA[speedAwaDiff + 5],
}

export interface BuntSizing {
  difference: number
  bases: BaseState
  outs: number
  contactMovDiff: AttributeDiff
  speedAwaDiff: AttributeDiff
}

const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, n))

/**
 * Select the bunt sub-result the difference lands in. The middle band seats
 * bunt-for-hit then the applicable sacrifice, each clamped so the two never
 * overflow `[4, 496]`; the dud absorbs whatever remains.
 */
export function selectBuntResult(
  sizing: BuntSizing,
  accessors: BuntAccessors = liveBuntAccessors,
): BuntResult {
  const { difference, bases, outs } = sizing
  if (difference <= BUTCHER_BOY_HI) return BuntResult.BUTCHER_BOY

  const { sac, topTail } = buntEligibility(bases, outs)
  if (difference >= TOP_TAIL_LO) return topTail

  const buntHit = clamp(accessors.buntHitWidth(sizing.contactMovDiff), 0, MIDDLE_WIDTH)
  const buntHitHi = MIDDLE_LO + buntHit - 1
  if (difference <= buntHitHi) return BuntResult.BUNT_HIT

  if (sac !== null) {
    const sacWidth = clamp(accessors.sacWidth(sizing.speedAwaDiff), 0, MIDDLE_WIDTH - buntHit)
    if (difference <= buntHitHi + sacWidth) return sac
  }
  return BuntResult.DUD
}
