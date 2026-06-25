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
const DP_FRACTION_CENTER = 0.44
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
  // Stub: implemented in the GREEN step.
  void eligible
  void band
  void speedDiff
  void GO_RA_FRACTION
  void TP_FRACTION
  void isFc
  return []
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
