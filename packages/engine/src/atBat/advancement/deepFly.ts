import type { Band } from '../../rangeFinder/frontHalf'
import type { BaseState, OutcomeApplication, RunnerId } from '../advance'
import type { BaseSpeeds } from '../resolve'

/**
 * Fly-out runner advancement (SAN-17, Rules §2.6 + §2.6.1/§2.6.16). The batter is
 * always out. With fewer than two outs:
 *   - a runner on 3rd **always** scores on a fly out (a sac fly, RBI credited) —
 *     this is NOT gated on the fly being deep (§2.6);
 *   - a **deep** fly additionally tags the runner on 2nd up to 3rd (§2.6.1). The
 *     deep-fly share sits at the batter-favorable (low) end of the `FO` band and
 *     floats with the runner-on-2nd's speed and the hitter's power (§2.6.16).
 * A runner on 1st never advances on a fly out. With two outs the fly ends the
 * inning: no run, no movement. Resolved deterministically off the folded
 * difference; no RNG.
 *
 * Provenance: the deep-fly share is structurally re-derived for this engine, NOT
 * transcribed from the reference calculator's Deep Fly tab (ADR-0006); the
 * per-speed/per-power share is a tunable seed behind the injectable accessor.
 */

const ATTR_MIN = 1
const ATTR_MAX = 5

/** Re-derived ~10%-baseline deep-fly contributions, indexed by attribute − 1. */
const DEEP_FLY_SPEED_TERM = [0.0, 0.02, 0.05, 0.08, 0.1] as const
const DEEP_FLY_POWER_TERM = [0.0, 0.02, 0.05, 0.08, 0.1] as const

/** Injectable so frozen test tables pin exact boundaries (SAN-15 retune-proof). */
export interface DeepFlyAccessors {
  /** Fraction [0,1] of the `FO` band that is a deep fly, by runner-on-2nd speed + power. */
  deepFlyFraction(secondRunnerSpeed: number, power: number): number
}

const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, n))
const clampAttr = (a: number): number => clamp(Math.round(a), ATTR_MIN, ATTR_MAX)

/** Exported so the gitignored parity lane can validate the live widths. */
export const liveDeepFlyAccessors: DeepFlyAccessors = {
  deepFlyFraction: (secondRunnerSpeed, power) =>
    clamp(
      DEEP_FLY_SPEED_TERM[clampAttr(secondRunnerSpeed) - 1] +
        DEEP_FLY_POWER_TERM[clampAttr(power) - 1],
      0,
      1,
    ),
}

export interface FlyOutInput {
  /** The folded 0–499 difference; must lie inside `band`. */
  difference: number
  /** The matchup's `FO` band, from `classify`. */
  band: Band
  bases: BaseState
  outsBefore: number
  /** The hitter's raw power (1–5) — part of the deep-fly axis. */
  power: number
  /** On-base runner speeds; the runner-on-2nd speed drives the deep-fly tag. */
  speeds: BaseSpeeds
}

/** Does the runner on 2nd tag up to 3rd (a deep fly at the low end of the band)? */
function isDeepFly(input: FlyOutInput, accessors: DeepFlyAccessors): boolean {
  const speed = input.speeds.second
  if (input.bases.second === null || speed === null) return false
  const bandWidth = input.band.hi - input.band.lo + 1
  const width = clamp(
    Math.round(accessors.deepFlyFraction(speed, input.power) * bandWidth),
    0,
    bandWidth,
  )
  return input.difference <= input.band.lo + width - 1
}

/**
 * Resolve a fly out: the batter is out (+1). With < 2 outs the runner on 3rd
 * scores and a deep fly tags the runner on 2nd up to 3rd; with 2 outs the inning
 * ends with no movement.
 */
export function resolveFlyOut(
  input: FlyOutInput,
  accessors: DeepFlyAccessors = liveDeepFlyAccessors,
): OutcomeApplication {
  const { bases, outsBefore } = input
  const outsAfter = outsBefore + 1
  if (outsAfter >= 3) {
    return { runsScored: 0, rbi: 0, basesAfter: { ...bases }, outsAfter }
  }

  const runsScored = bases.third ? 1 : 0 // a runner on 3rd scores on any fly out (§2.6)
  let second: RunnerId | null = bases.second
  let third: RunnerId | null = null // the runner on 3rd (if any) has scored
  if (isDeepFly(input, accessors)) {
    third = bases.second // the runner on 2nd tags up to 3rd
    second = null
  }
  return {
    runsScored,
    rbi: runsScored,
    basesAfter: { first: bases.first, second, third },
    outsAfter,
  }
}
