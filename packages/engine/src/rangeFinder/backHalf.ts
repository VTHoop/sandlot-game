/** Inclusive {lo, hi} boundary on the 0–499 score range. */
export interface Band {
  lo: number
  hi: number
}

export interface BackHalfDiffs {
  /** Power − Velocity: drives FO and PO band widths */
  powerVel: number
  /** Contact − Movement: drives K band width */
  contactMov: number
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
  getFo(diff: number): number
  getPo(diff: number): number
  getK(diff: number): number
}

export function assembleBackHalf(
  _diffs: BackHalfDiffs,
  _bbHiPlusOne: number,
  _accessors?: BackHalfAccessors,
): BackHalfBands {
  throw new Error('not implemented')
}
