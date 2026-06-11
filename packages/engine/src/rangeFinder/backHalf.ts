import type { AttributeDiff } from '../tables/accessor'
import { getFo, getK, getPo } from '../tables/accessor'

/** Inclusive {lo, hi} boundary on the 0–499 score range. */
export interface Band {
  lo: number
  hi: number
}

export interface BackHalfDiffs {
  /** Power − Velocity: drives FO and PO band widths */
  powerVel: AttributeDiff
  /** Contact − Movement: drives K band width */
  contactMov: AttributeDiff
}

/** Cumulative band partition for the four back-half outcomes (FO → PO → GB → K). */
export interface BackHalfBands {
  FO: Band
  PO: Band
  GB: Band
  K: Band
}

/**
 * Accessor interface for dependency injection.
 * The default live implementation delegates to `tables/accessor.ts`.
 * Tests inject a frozen stand-in so SAN-15 retuning never breaks this suite.
 */
export interface BackHalfAccessors {
  getFo(diff: AttributeDiff): number
  getPo(diff: AttributeDiff): number
  getK(diff: AttributeDiff): number
}

const liveAccessors: BackHalfAccessors = { getFo, getK, getPo }

/**
 * Assembles the back-half cumulative band partition.
 *
 * Given the two relevant attribute differentials and the front half's ending
 * cursor (BB.hi + 1), produces the cumulative band-boundary partition for
 * FO → PO → GB → K covering exactly BB.hi + 1 through 499.
 *
 * - K is right-anchored at 499: K.hi = 499 always; K.lo = 499 − K_width + 1.
 * - GB is elastic: GB.lo = PO.hi + 1, GB.hi = K.lo − 1.
 * - Throws RangeError if GB_width < 0 (FO + PO + K widths exceed available space).
 * - Deterministic and self-contained: no I/O, clock, or randomness.
 * - Out-of-range diffs are clamped to [−5, +5] by the accessor layer.
 */
export function assembleBackHalf(
  diffs: BackHalfDiffs,
  bbHiPlusOne: number,
  accessors: BackHalfAccessors = liveAccessors,
): BackHalfBands {
  const { powerVel, contactMov } = diffs

  const foWidth = accessors.getFo(powerVel)
  const poWidth = accessors.getPo(powerVel)
  const kWidth = accessors.getK(contactMov)

  const foLo = bbHiPlusOne
  const foHi = foLo + foWidth - 1
  const poLo = foHi + 1
  const poHi = poLo + poWidth - 1

  const kLo = 500 - kWidth
  const kHi = 499

  const gbLo = poHi + 1
  const gbHi = kLo - 1
  const gbWidth = gbHi - gbLo + 1

  // GB width of 0 would produce a band with hi < lo (structurally invalid);
  // guard <= 0 so the assembler never returns degenerate output.
  if (gbWidth <= 0) {
    throw new RangeError(
      `GB band width is ${gbWidth}: FO+PO+K widths exceed available back-half space`,
    )
  }

  return {
    FO: { lo: foLo, hi: foHi },
    PO: { lo: poLo, hi: poHi },
    GB: { lo: gbLo, hi: gbHi },
    K: { lo: kLo, hi: kHi },
  }
}
