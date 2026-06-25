import type { Band } from '../../rangeFinder/frontHalf'
import { GroundBallResult } from './result'

/**
 * Re-derived ground-ball sub-band sizing constants (SAN-16).
 *
 * Provenance: structurally re-derived for this engine, NOT transcribed from the
 * reference calculator's tuned Ground Balls sheet (the literal TP sliver and its
 * per-stat FC/DP fractions are private reference only — ADR-0006). The DP-vs-FC
 * split is the speed−awareness axis: faster runners convert force double plays
 * into fielder's choices, so the DP share falls and the FC share (the remainder)
 * rises with the differential. GO_RA is a small near-constant slice; TP is a thin
 * top-of-band tail. Magnitudes are tuned against the GIDP-per-opportunity baseline
 * by the Monte Carlo harness, exactly as the seed tables were tuned by SAN-15.
 */
const GO_RA_FRACTION = 0.08
const DP_FRACTION_CENTER = 0.47
const DP_FRACTION_PER_SPEED = 0.06
const DP_FRACTION_MIN = 0.2
const DP_FRACTION_MAX = 0.68
/** TP is a thin top tail; it is guaranteed at least one number when eligible. */
const TP_FRACTION = 0.01

/** A contiguous slice of the GB band assigned to one sub-result. */
export interface GroundBallSubBand {
  result: GroundBallResult
  lo: number
  hi: number
}

const isFc = (r: GroundBallResult): boolean =>
  r === GroundBallResult.FC ||
  r === GroundBallResult.FC_2ND ||
  r === GroundBallResult.FC_3RD ||
  r === GroundBallResult.FC_HOME

/** DP share of the GB band, shrinking as the runner/batter speed edge over the pitcher rises. */
export function dpFraction(speedDiff: number): number {
  const raw = DP_FRACTION_CENTER - DP_FRACTION_PER_SPEED * speedDiff
  return Math.min(DP_FRACTION_MAX, Math.max(DP_FRACTION_MIN, raw))
}

/**
 * Target fraction of the GB band for each eligible result (sums to 1). TP takes a
 * thin constant tail, DP its speed-driven share, GO_RA a small constant, and the
 * fielder's-choice family splits the remainder — so as DP shrinks with the speed
 * edge the FC share grows. When no FC variant is eligible (bases empty, or a lone
 * runner on 2nd/3rd) the sole ground-out result absorbs the whole band.
 */
function targetFractions(
  eligible: GroundBallResult[],
  speedDiff: number,
): Map<GroundBallResult, number> {
  const fcVariants = eligible.filter(isFc)
  const weights = new Map<GroundBallResult, number>()
  let remainder = 1

  if (eligible.includes(GroundBallResult.TP)) {
    weights.set(GroundBallResult.TP, TP_FRACTION)
    remainder -= TP_FRACTION
  }
  if (eligible.includes(GroundBallResult.DP)) {
    const dp = dpFraction(speedDiff)
    weights.set(GroundBallResult.DP, dp)
    remainder -= dp
  }

  if (fcVariants.length > 0) {
    if (eligible.includes(GroundBallResult.GO_RA)) {
      weights.set(GroundBallResult.GO_RA, GO_RA_FRACTION)
      remainder -= GO_RA_FRACTION
    }
    const each = remainder / fcVariants.length
    for (const fc of fcVariants) weights.set(fc, each)
  } else {
    // No fielder's choice possible: the lone ground-out result takes the remainder.
    const absorber = eligible.find((r) => r !== GroundBallResult.TP && r !== GroundBallResult.DP)
    if (absorber) weights.set(absorber, (weights.get(absorber) ?? 0) + remainder)
  }
  return weights
}

const argmax = (xs: number[]): number => xs.reduce((best, x, i) => (x > xs[best] ? i : best), 0)

/**
 * Convert the per-result fractions into integer widths summing exactly to `W`
 * (largest-remainder apportionment), then guarantee reachability: every eligible
 * slice gets at least one number when the band is wide enough, and TP keeps its
 * top-tail number even in a squeezed band.
 */
function allocateWidths(
  eligible: GroundBallResult[],
  weights: Map<GroundBallResult, number>,
  W: number,
): number[] {
  const ideals = eligible.map((r) => (weights.get(r) ?? 0) * W)
  const widths = ideals.map(Math.floor)
  const remainders = eligible
    .map((_, i) => ({ i, frac: ideals[i] - widths[i] }))
    .sort((a, b) => b.frac - a.frac)
  let leftover = W - widths.reduce((a, b) => a + b, 0)
  for (let k = 0; leftover > 0; k++, leftover--) widths[remainders[k % remainders.length].i] += 1

  // Move one number from the widest slice to `target`. `floor` is the smallest
  // donor width allowed to give: `> 1` lifts a zero without creating a new one
  // (used when there is room for everyone); `>= 1` lets a lower-priority slice be
  // dropped to zero so a higher-priority one (TP) is still seated in a squeeze.
  const liftInto = (target: number, floor: number): void => {
    const donor = argmax(widths)
    if (donor !== target && widths[donor] >= floor) {
      widths[donor] -= 1
      widths[target] += 1
    }
  }
  if (W >= eligible.length) {
    for (let i = 0; i < widths.length; i++) if (widths[i] === 0) liftInto(i, 2)
  } else {
    // Too few numbers to seat everyone — keep TP's structural top-of-band tail,
    // dropping the widest lower-priority slice if that is the only way to seat it.
    const tp = eligible.indexOf(GroundBallResult.TP)
    if (tp >= 0 && widths[tp] === 0) liftInto(tp, 1)
  }
  return widths
}

/**
 * Partition `[band.lo, band.hi]` into contiguous, gapless, non-overlapping
 * sub-bands — one per eligible sub-result, in the given low→high order. TP, when
 * present, is the top slice and is guaranteed at least one number ("top of the GB
 * band"). Deterministic given (eligible, band, speedDiff).
 */
export function partitionGroundBall(
  eligible: GroundBallResult[],
  band: Band,
  speedDiff: number,
): GroundBallSubBand[] {
  const width = band.hi - band.lo + 1
  const widths = allocateWidths(eligible, targetFractions(eligible, speedDiff), width)
  const subBands: GroundBallSubBand[] = []
  let cursor = band.lo
  eligible.forEach((result, i) => {
    if (widths[i] === 0) return // collapsed in an extreme squeeze — contributes no numbers
    subBands.push({ result, lo: cursor, hi: cursor + widths[i] - 1 })
    cursor += widths[i]
  })
  return subBands
}

/** Select the sub-result whose sub-band contains `difference` (must lie in `band`). */
export function selectGroundBallResult(
  difference: number,
  eligible: GroundBallResult[],
  band: Band,
  speedDiff: number,
): GroundBallResult {
  const bands = partitionGroundBall(eligible, band, speedDiff)
  const match = bands.find((sub) => difference >= sub.lo && difference <= sub.hi)
  if (!match) throw new RangeError(`difference ${difference} is outside the GB band partition`)
  return match.result
}
