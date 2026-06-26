import type { Band } from '../../rangeFinder/frontHalf'
import type { BaseState, OutcomeApplication } from '../advance'

/**
 * Deep-fly / sac-fly sub-resolution of the `FO` band (SAN-17, Rules §3.2.6.1).
 *
 * A fly out is usually a plain out, but a *deep* fly lets runners tag up: the
 * runner on 3rd scores (a sac fly, RBI credited) and the runner on 2nd advances to
 * 3rd. The deep-fly share sits at the batter-favorable (low) end of the `FO` band
 * and widens with the hitter's raw power — more power drives deeper, more
 * productive fly outs. Resolved deterministically off the folded difference; no RNG.
 *
 * Provenance: the deep-fly share is structurally re-derived for this engine, NOT
 * transcribed from the reference calculator's Deep Fly tab (ADR-0006). The exact
 * per-power widths are tunable seeds behind the injectable accessor.
 */

/** Raw hitter-power clamp bounds (1–5). */
const POWER_MIN = 1
const POWER_MAX = 5

/** Re-derived deep-fly share of the `FO` band, indexed by raw power − 1. */
const DEEP_FLY_FRACTION_BY_POWER = [0.1, 0.2, 0.3, 0.4, 0.5] as const

/** Injectable so frozen test tables pin exact boundaries (SAN-15 retune-proof). */
export interface DeepFlyAccessors {
  /** Fraction [0,1] of the `FO` band that is a deep (runner-advancing) fly, by power. */
  deepFlyFraction(power: number): number
}

const clampPower = (power: number): number =>
  Math.max(POWER_MIN, Math.min(POWER_MAX, Math.round(power)))

/** Exported so the gitignored parity lane can validate the live widths. */
export const liveDeepFlyAccessors: DeepFlyAccessors = {
  deepFlyFraction: (power) => DEEP_FLY_FRACTION_BY_POWER[clampPower(power) - 1],
}

export interface FlyOutInput {
  /** The folded 0–499 difference; must lie inside `band`. */
  difference: number
  /** The matchup's `FO` band, from `classify`. */
  band: Band
  bases: BaseState
  outsBefore: number
  /** The hitter's raw power (1–5) — drives the deep-fly share. */
  power: number
}

/**
 * Resolve a fly out into a plain out or a deep fly (tag-ups). The batter is always
 * out (+1). A deep fly applies only with < 2 outs and a runner who can tag (2nd or
 * 3rd); otherwise the fly is a plain out with no movement. (SAN-17 RED stub.)
 */
export function resolveFlyOut(
  input: FlyOutInput,
  accessors: DeepFlyAccessors = liveDeepFlyAccessors,
): OutcomeApplication {
  const { difference, band, bases, outsBefore, power } = input
  const outsAfter = outsBefore + 1
  const plainOut: OutcomeApplication = {
    runsScored: 0,
    rbi: 0,
    basesAfter: { ...bases },
    outsAfter,
  }

  // The fly out is the inning's third out (no run counts), or no runner can tag
  // (only 1st occupied, or empty) — a plain fly out either way.
  if (outsAfter >= 3 || (bases.second === null && bases.third === null)) return plainOut

  const bandWidth = band.hi - band.lo + 1
  const deepWidth = Math.min(bandWidth, Math.round(accessors.deepFlyFraction(power) * bandWidth))
  const isDeep = difference <= band.lo + deepWidth - 1
  if (!isDeep) return plainOut

  // Deep fly, < 2 outs: the runner on 3rd tags and scores (RBI); the runner on 2nd
  // tags up to 3rd; a runner on 1st holds (a fly out is not deep enough to advance
  // from first without being a hit).
  const runsScored = bases.third ? 1 : 0
  return {
    runsScored,
    rbi: runsScored,
    basesAfter: { first: bases.first, second: null, third: bases.second },
    outsAfter,
  }
}
