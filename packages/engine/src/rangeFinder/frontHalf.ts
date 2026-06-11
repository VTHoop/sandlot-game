import { getBb, getDouble, getHr, getIf1b, getSingle, getTriple } from '../tables/accessor'

export interface FrontHalfDiffs {
  /** Power − Velocity: drives HR band width */
  powerVel: number
  /** Speed − Awareness: drives 3B, 2B, and IF1B band widths */
  speedAwa: number
  /** Eye − Command: drives BB band width */
  eyeCmd: number
  /** Contact − Movement: drives 1B width via hit-total residual */
  contactMov: number
}

export interface Band {
  /** Inclusive lower boundary on the 0–499 score range */
  lo: number
  /** Inclusive upper boundary on the 0–499 score range */
  hi: number
}

/** Cumulative band partition for the six front-half outcomes (HR → BB). */
export interface FrontHalfBands {
  HR: Band
  '3B': Band
  '2B': Band
  '1B': Band
  IF1B: Band
  BB: Band
}

/**
 * Accessor interface for dependency injection.
 * The default live implementation delegates to `tables/accessor.ts`.
 * Tests inject a frozen stand-in so SAN-15 retuning never breaks this suite.
 */
export interface FrontHalfAccessors {
  getHr(diff: number): number
  getTriple(diff: number): number
  getDouble(diff: number): number
  getSingle(diffs: { contactMov: number; powerVel: number; speedAwa: number }): number
  getIf1b(diff: number): number
  getBb(diff: number): number
}

const liveAccessors: FrontHalfAccessors = {
  getHr,
  getTriple,
  getDouble,
  getSingle,
  getIf1b,
  getBb,
}

/**
 * Assembles the front-half cumulative band partition.
 *
 * Given the four attribute differentials, returns {lo, hi} boundaries for
 * HR → 3B → 2B → 1B → IF1B → BB, stacked from 0, each band immediately
 * following the previous (no gaps, no overlaps).
 *
 * - Deterministic and self-contained: no I/O, clock, or randomness.
 * - Out-of-range diffs are clamped to [−5, +5] by the accessor layer.
 */
export function assembleFrontHalf(
  diffs: FrontHalfDiffs,
  accessors: FrontHalfAccessors = liveAccessors,
): FrontHalfBands {
  const { powerVel, speedAwa, eyeCmd, contactMov } = diffs

  const hrWidth = accessors.getHr(powerVel)
  const tripleWidth = accessors.getTriple(speedAwa)
  const doubleWidth = accessors.getDouble(speedAwa)
  const singleWidth = accessors.getSingle({ contactMov, powerVel, speedAwa })
  const if1bWidth = accessors.getIf1b(speedAwa)
  const bbWidth = accessors.getBb(eyeCmd)

  const widths: [keyof FrontHalfBands, number][] = [
    ['HR', hrWidth],
    ['3B', tripleWidth],
    ['2B', doubleWidth],
    ['1B', singleWidth],
    ['IF1B', if1bWidth],
    ['BB', bbWidth],
  ]

  return widths.reduce<{ bands: Partial<FrontHalfBands>; cursor: number }>(
    ({ bands, cursor }, [name, width]) => {
      if (width <= 0) throw new RangeError(`band width must be positive, got ${width}`)
      return {
        bands: { ...bands, [name]: { lo: cursor, hi: cursor + width - 1 } },
        cursor: cursor + width,
      }
    },
    { bands: {}, cursor: 0 },
  ).bands as FrontHalfBands
}
