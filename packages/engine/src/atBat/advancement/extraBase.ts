import type { Band } from '../../rangeFinder/frontHalf'
import type { BaseState, OutcomeApplication, RunnerId } from '../advance'
import type { BaseSpeeds } from '../resolve'

/**
 * Extra-base advancement on a hit (SAN-17, Rules §3.2). On a single or double a
 * trailing runner may take one *extra* base beyond the standard one-/two-base
 * push, deterministically off the folded difference: the batter-favorable (low)
 * end of the hit band grants the extra base, and the granting range widens with
 * the runner's own speed (and the hitter's power, where the ExtraBase tab uses it).
 *
 * A trailing runner can never pass the runner ahead: the extra base from 1st→3rd
 * on a single is available only when 3rd is vacated by the runner who was on 2nd.
 *
 * Provenance: the extra-base shares are structurally re-derived for this engine,
 * NOT transcribed from the reference calculator's ExtraBase tab (ADR-0006); the
 * per-speed/per-power widths are tunable seeds behind the injectable accessor.
 */

const SPEED_MIN = 1
const SPEED_MAX = 5
const POWER_MIN = 1
const POWER_MAX = 5

/** Re-derived extra-base share of the hit band, indexed by runner speed − 1. */
const EXTRA_BASE_FRACTION_BY_SPEED = [0.1, 0.22, 0.35, 0.5, 0.66] as const
/** Small hitter-power adjustment to the share, indexed by power − 1. */
const POWER_ADJUSTMENT = [-0.04, -0.02, 0.0, 0.02, 0.04] as const

/** Injectable so frozen test tables pin exact boundaries (SAN-15 retune-proof). */
export interface ExtraBaseAccessors {
  /** Fraction [0,1] of the hit band granting an extra base, by runner speed + hitter power. */
  extraBaseFraction(speed: number, power: number): number
}

const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, n))
const clampSpeed = (s: number): number => clamp(Math.round(s), SPEED_MIN, SPEED_MAX)
const clampPower = (p: number): number => clamp(Math.round(p), POWER_MIN, POWER_MAX)

/** Exported so the gitignored parity lane can validate the live widths. */
export const liveExtraBaseAccessors: ExtraBaseAccessors = {
  extraBaseFraction: (speed, power) =>
    clamp(
      EXTRA_BASE_FRACTION_BY_SPEED[clampSpeed(speed) - 1] + POWER_ADJUSTMENT[clampPower(power) - 1],
      0,
      1,
    ),
}

export interface ExtraBaseInput {
  /** The hit band — `1B` or `2B`. */
  outcome: '1B' | '2B'
  /** The folded 0–499 difference; must lie inside `band`. */
  difference: number
  /** The matchup's `1B`/`2B` band, from `classify`. */
  band: Band
  bases: BaseState
  outsBefore: number
  batter: RunnerId
  /** On-base runner speeds, positionally aligned to `bases`. */
  speeds: BaseSpeeds
  /** The hitter's raw power (1–5). */
  power: number
}

/** Does the folded difference fall in this runner's extra-base range (band's low
 * end, width scaled by speed + power)? An empty base never qualifies. */
function qualifies(
  speed: number | null,
  power: number,
  band: Band,
  difference: number,
  accessors: ExtraBaseAccessors,
): boolean {
  if (speed === null) return false
  const bandWidth = band.hi - band.lo + 1
  const extraWidth = clamp(
    Math.round(accessors.extraBaseFraction(speed, power) * bandWidth),
    0,
    bandWidth,
  )
  return difference <= band.lo + extraWidth - 1
}

/**
 * Single: the runner on 3rd always scores. The runner on 2nd scores on the extra
 * base else holds at 3rd; the runner on 1st reaches 3rd on the extra base only when
 * 3rd is free (the runner ahead vacated it) else holds at 2nd. Batter to first.
 */
function advanceSingle(input: ExtraBaseInput, accessors: ExtraBaseAccessors): OutcomeApplication {
  const { bases, batter, speeds, power, band, difference, outsBefore } = input
  let runsScored = bases.third ? 1 : 0
  let third: RunnerId | null = null
  if (bases.second) {
    if (qualifies(speeds.second, power, band, difference, accessors)) runsScored += 1
    else third = bases.second
  }
  let second: RunnerId | null = null
  if (bases.first) {
    if (third === null && qualifies(speeds.first, power, band, difference, accessors))
      third = bases.first
    else second = bases.first
  }
  return {
    runsScored,
    rbi: runsScored,
    basesAfter: { first: batter, second, third },
    outsAfter: outsBefore,
  }
}

/**
 * Double: the runners on 2nd and 3rd always score. The runner on 1st scores on the
 * extra base else holds at 3rd (home is always open, so no passing constraint).
 * Batter to second.
 */
function advanceDouble(input: ExtraBaseInput, accessors: ExtraBaseAccessors): OutcomeApplication {
  const { bases, batter, speeds, power, band, difference, outsBefore } = input
  let runsScored = (bases.third ? 1 : 0) + (bases.second ? 1 : 0)
  let third: RunnerId | null = null
  if (bases.first) {
    if (qualifies(speeds.first, power, band, difference, accessors)) runsScored += 1
    else third = bases.first
  }
  return {
    runsScored,
    rbi: runsScored,
    basesAfter: { first: null, second: batter, third },
    outsAfter: outsBefore,
  }
}

/**
 * Resolve a single or double with extra-base advancement. The batter reaches first
 * (single) or second (double); no out is recorded, so outs pass straight through.
 */
export function resolveExtraBase(
  input: ExtraBaseInput,
  accessors: ExtraBaseAccessors = liveExtraBaseAccessors,
): OutcomeApplication {
  return input.outcome === '2B' ? advanceDouble(input, accessors) : advanceSingle(input, accessors)
}
