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

/** The inputs that size a GB sub-partition — eligibility, the elastic band, and
 * the speed axis always travel together. */
export interface GroundBallSizing {
  eligible: GroundBallResult[]
  band: Band
  speedDiff: number
}

/** A sub-result with its allocated integer width — the working value during sizing. */
interface SizedResult {
  result: GroundBallResult
  width: number
}

const FC_RESULTS: ReadonlySet<GroundBallResult> = new Set([
  GroundBallResult.FC,
  GroundBallResult.FC_2ND,
  GroundBallResult.FC_3RD,
  GroundBallResult.FC_HOME,
])

const bandWidth = (band: Band): number => band.hi - band.lo + 1

/** DP share of the GB band, shrinking as the runner/batter speed edge over the pitcher rises. */
function dpFraction(speedDiff: number): number {
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
function targetFractions({ eligible, speedDiff }: GroundBallSizing): Map<GroundBallResult, number> {
  const fcVariants = eligible.filter((r) => FC_RESULTS.has(r))
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

const widest = (sized: SizedResult[]): SizedResult =>
  sized.reduce((best, slice) => (slice.width > best.width ? slice : best), sized[0])

/**
 * Apportion the target fractions into integer widths summing exactly to the band
 * width (largest-remainder method): floor each ideal, then hand the leftover to
 * the largest fractional remainders, in eligible (low→high) order.
 */
function apportion(sizing: GroundBallSizing): SizedResult[] {
  const total = bandWidth(sizing.band)
  const fractions = targetFractions(sizing)
  const ideals = sizing.eligible.map((r) => (fractions.get(r) ?? 0) * total)
  const sized: SizedResult[] = sizing.eligible.map((result, i) => ({
    result,
    width: Math.floor(ideals[i]),
  }))
  const byFraction = ideals
    .map((ideal, i) => ({ i, frac: ideal - sized[i].width }))
    .sort((a, b) => b.frac - a.frac)
  let leftover = total - sized.reduce((sum, s) => sum + s.width, 0)
  for (let k = 0; leftover > 0; k++, leftover--)
    sized[byFraction[k % byFraction.length].i].width += 1
  return sized
}

/**
 * Move one number from the widest slice into `slice`. `minDonor` is the smallest
 * donor width allowed to give: `2` lifts a zero without creating a new one (when
 * there is room for everyone); `1` lets a lower-priority slice be dropped to zero
 * so a higher-priority one (TP) is still seated in a squeeze.
 */
function seat(sized: SizedResult[], slice: SizedResult, minDonor: number): void {
  const donor = widest(sized)
  if (donor !== slice && donor.width >= minDonor) {
    donor.width -= 1
    slice.width += 1
  }
}

/**
 * Guarantee reachability in place: every eligible slice gets at least one number
 * when the band is wide enough, and TP keeps its top-tail number even in a band
 * narrower than the eligible set (dropping the widest lower-priority slice).
 */
function ensureReachable(sized: SizedResult[], band: Band): void {
  if (bandWidth(band) >= sized.length) {
    for (const slice of sized) if (slice.width === 0) seat(sized, slice, 2)
    return
  }
  const tp = sized.find((slice) => slice.result === GroundBallResult.TP)
  if (tp && tp.width === 0) seat(sized, tp, 1)
}

/**
 * Partition `[band.lo, band.hi]` into contiguous, gapless, non-overlapping
 * sub-bands — one per eligible sub-result, in the given low→high order. TP, when
 * present, is the top slice and is guaranteed at least one number ("top of the GB
 * band"). Deterministic given the sizing inputs.
 */
export function partitionGroundBall(sizing: GroundBallSizing): GroundBallSubBand[] {
  const sized = apportion(sizing)
  ensureReachable(sized, sizing.band)
  const subBands: GroundBallSubBand[] = []
  let cursor = sizing.band.lo
  for (const { result, width } of sized) {
    if (width === 0) continue // collapsed in an extreme squeeze — contributes no numbers
    subBands.push({ result, lo: cursor, hi: cursor + width - 1 })
    cursor += width
  }
  return subBands
}

/** Select the sub-result whose sub-band contains `difference` (must lie in the band). */
export function selectGroundBallResult(
  sizing: GroundBallSizing,
  difference: number,
): GroundBallResult {
  const match = partitionGroundBall(sizing).find(
    (sub) => difference >= sub.lo && difference <= sub.hi,
  )
  if (!match) throw new RangeError(`difference ${difference} is outside the GB band partition`)
  return match.result
}
