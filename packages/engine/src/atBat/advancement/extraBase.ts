import type { Band } from '../../rangeFinder/frontHalf'
import type { BaseState, OutcomeApplication, RunnerId } from '../advance'
import type { BaseSpeeds } from '../resolve'
import { clamp } from './utils'

/**
 * Extra-base advancement on a hit (SAN-17, Rules §2.6.15 + §2.3). A "well hit"
 * single or double advances **every** on-base runner one extra base — exactly the
 * two-out advancement — and the two do not stack. It is a single all-or-nothing
 * determination off the folded difference (the batter-favorable / low end of the
 * hit band), sized by a floating share of the **average** of the on-base runners'
 * speeds (hitter power is *not* a factor for hits — that is the deep-fly axis,
 * §2.6.16). No RNG.
 *
 * Provenance: the well-hit share is structurally re-derived for this engine, NOT
 * transcribed from the reference calculator's ExtraBase tab (ADR-0006); the
 * per-speed share is a tunable seed behind the injectable accessor.
 */

const SPEED_MIN = 1
const SPEED_MAX = 5

/** Re-derived well-hit share of the hit band, indexed by rounded average speed − 1. */
const WELL_HIT_FRACTION_BY_SPEED = [0.1, 0.2, 0.3, 0.4, 0.5] as const

/** Injectable so frozen test tables pin exact boundaries (SAN-15 retune-proof). */
export interface ExtraBaseAccessors {
  /** Fraction [0,1] of the hit band that is "well hit", by the average runner speed. */
  wellHitFraction(averageSpeed: number): number
}

const clampSpeed = (s: number): number => clamp(Math.round(s), SPEED_MIN, SPEED_MAX)

/** Exported so the gitignored parity lane can validate the live widths;
 * `satisfies` enforces the contract while keeping the narrow return type. */
export const liveExtraBaseAccessors = {
  wellHitFraction: (averageSpeed: number) =>
    WELL_HIT_FRACTION_BY_SPEED[clampSpeed(averageSpeed) - 1],
} satisfies ExtraBaseAccessors

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
}

/** Mean of the on-base runners' speeds; null when no runner is aboard. */
function averageRunnerSpeed(speeds: BaseSpeeds): number | null {
  const present = [speeds.first, speeds.second, speeds.third].filter((s): s is number => s !== null)
  if (present.length === 0) return null
  return present.reduce((sum, s) => sum + s, 0) / present.length
}

/** Is this a well-hit ball (difference in the band's batter-favorable low end)? */
function isWellHit(input: ExtraBaseInput, accessors: ExtraBaseAccessors): boolean {
  const avg = averageRunnerSpeed(input.speeds)
  if (avg === null) return false // no runner to advance — the extra base is moot
  const bandWidth = input.band.hi - input.band.lo + 1
  const width = clamp(Math.round(accessors.wellHitFraction(avg) * bandWidth), 0, bandWidth)
  return input.difference <= input.band.lo + width - 1
}

/** Standard single: 3rd scores, 2nd→3rd, 1st→2nd, batter to first. */
const single = (b: BaseState, batter: RunnerId): OutcomeApplication => {
  const runsScored = b.third ? 1 : 0
  return {
    runsScored,
    rbi: runsScored,
    basesAfter: { first: batter, second: b.first, third: b.second },
    outsAfter: 0,
  }
}

/** Extra single (well hit / 2 outs): 3rd & 2nd score, 1st→3rd, batter to first. */
const extraSingle = (b: BaseState, batter: RunnerId): OutcomeApplication => {
  const runsScored = (b.third ? 1 : 0) + (b.second ? 1 : 0)
  return {
    runsScored,
    rbi: runsScored,
    basesAfter: { first: batter, second: null, third: b.first },
    outsAfter: 0,
  }
}

/** Standard double: 3rd & 2nd score, 1st→3rd, batter to second. */
const double = (b: BaseState, batter: RunnerId): OutcomeApplication => {
  const runsScored = (b.third ? 1 : 0) + (b.second ? 1 : 0)
  return {
    runsScored,
    rbi: runsScored,
    basesAfter: { first: null, second: batter, third: b.first },
    outsAfter: 0,
  }
}

/** Extra double (well hit / 2 outs): every runner scores, batter to second. */
const extraDouble = (b: BaseState, batter: RunnerId): OutcomeApplication => {
  const runsScored = (b.third ? 1 : 0) + (b.second ? 1 : 0) + (b.first ? 1 : 0)
  return {
    runsScored,
    rbi: runsScored,
    basesAfter: { first: null, second: batter, third: null },
    outsAfter: 0,
  }
}

/**
 * Resolve a single or double, applying the extra (two-out-style) advancement when
 * the ball is well hit OR there are already two outs — the two never stack. The
 * batter reaches first (single) or second (double); no out is recorded, so the
 * pre-state out count passes straight through.
 */
export function resolveExtraBase(
  input: ExtraBaseInput,
  accessors: ExtraBaseAccessors = liveExtraBaseAccessors,
): OutcomeApplication {
  const { outcome, bases, batter, outsBefore } = input
  const extra = outsBefore >= 2 || isWellHit(input, accessors)
  const move = outcome === '2B' ? (extra ? extraDouble : double) : extra ? extraSingle : single
  return { ...move(bases, batter), outsAfter: outsBefore }
}
