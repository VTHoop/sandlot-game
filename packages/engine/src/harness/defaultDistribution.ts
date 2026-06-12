import type { AttributeDiff } from '../tables/accessor'
import type { CellDiffs, DifferentialWeightFn } from './types'

/**
 * Default differential distribution derived from the attribute-bucket (1–5) design.
 *
 * Each attribute is drawn independently and uniformly from {1,2,3,4,5}.
 * The batter−pitcher differential is therefore triangularly distributed:
 *   P(d) = (5 − |d|) / 25  for d ∈ {−4,…,+4},  0 for |d| = 5.
 *
 * The 4-D cell weight is the product of four independent marginal distributions.
 * Diffs of ±5 are unreachable from attributes in [1,5] and receive weight 0.
 *
 * Source: attribute-normalization.md (attribute-bucket design).
 * Injectable so SAN-15 retuning and future real-pool weighting need no code surgery.
 */
function marginalWeight(d: AttributeDiff): number {
  const abs = Math.abs(d)
  return abs >= 5 ? 0 : (5 - abs) / 25
}

export const defaultDifferentialWeight: DifferentialWeightFn = (diffs: CellDiffs): number =>
  marginalWeight(diffs.powerVel) *
  marginalWeight(diffs.speedAwa) *
  marginalWeight(diffs.eyeCmd) *
  marginalWeight(diffs.contactMov)
