import type { BaseState } from '../atBat/advance'
import { eligibleGroundBallResults } from '../atBat/groundBall/eligibility'
import { partitionGroundBall } from '../atBat/groundBall/partition'
import { GroundBallResult } from '../atBat/groundBall/result'
import { defaultDifferentialWeight } from './defaultDistribution'
import type { CellResult, DifferentialWeightFn } from './types'

/** The 0–499 difference line has 500 positions (the harness rate identity). */
const RANGE = 500

/**
 * League-average speeds vs awareness — the neutral GB speed axis the aggregate
 * GIDP rate is computed at (individual runner/batter speeds are not modeled in the
 * analytic grid; the per-matchup variation lives in the GB band width).
 */
const NEUTRAL_SPEED_DIFF = 0

/** A double-play opportunity (a force at first, < 2 outs) and its real-game weight. */
export interface OpportunityState {
  bases: BaseState
  outs: number
  weight: number
}

const onBase = (first: boolean, second: boolean, third: boolean): BaseState => ({
  first: first ? 'r1' : null,
  second: second ? 'r2' : null,
  third: third ? 'r3' : null,
})

/**
 * The base × out states that constitute a GIDP opportunity, weighted by their
 * real-game relative frequency.
 *
 * Provenance: rough public situational frequencies (Retrosheet base/out state
 * occupancy among runner-on-first, <2-out plate appearances), re-derived for this
 * harness — not from any private workbook (ADR-0006). Runner-on-first-only is by
 * far the most common; loaded and 1st&3rd are rarer. The 0-out vs 1-out split
 * leans slightly toward one out. Weights need not sum to 1 (normalized at use).
 */
export const GIDP_OPPORTUNITY_STATES: OpportunityState[] = [
  [onBase(true, false, false), 0.62],
  [onBase(true, true, false), 0.18],
  [onBase(true, false, true), 0.1],
  [onBase(true, true, true), 0.1],
].flatMap(([bases, baseWeight]) =>
  [
    [0, 0.45],
    [1, 0.55],
  ].map(([outs, outWeight]) => ({
    bases: bases as BaseState,
    outs: outs as number,
    weight: (baseWeight as number) * (outWeight as number),
  })),
)

/** Width of the DP sub-band for a GB of `gbWidth` in the given state (0 if ineligible). */
function dpBandWidth(gbWidth: number, bases: BaseState, outs: number, speedDiff: number): number {
  const eligible = eligibleGroundBallResults(bases, outs)
  const bands = partitionGroundBall({ eligible, band: { lo: 0, hi: gbWidth - 1 }, speedDiff })
  const dp = bands.find((band) => band.result === GroundBallResult.DP)
  return dp ? dp.hi - dp.lo + 1 : 0
}

/**
 * Harness-derived GIDP per double-play opportunity: the DP sub-band width (a GB
 * landing on a DP) over the full difference range, averaged across the
 * differential grid (weighted by the matchup distribution) and the opportunity
 * base/out states (weighted by their real-game frequency).
 */
export function gidpPerOpportunity(
  cells: CellResult[],
  opportunities: OpportunityState[] = GIDP_OPPORTUNITY_STATES,
  weightFn: DifferentialWeightFn = defaultDifferentialWeight,
  speedDiff: number = NEUTRAL_SPEED_DIFF,
): number {
  const opportunityWeight = opportunities.reduce((sum, o) => sum + o.weight, 0)
  if (opportunityWeight === 0) {
    throw new RangeError('gidpPerOpportunity: opportunity weights sum to zero')
  }

  let weightedGidp = 0
  let totalWeight = 0
  for (const cell of cells) {
    const w = weightFn(cell.diffs)
    if (w <= 0) continue
    const gbWidth = Math.round(cell.rates.gb * RANGE)
    // Per opportunity state, P(GIDP) = P(GB) × DP-share-of-GB = DP-width / RANGE.
    let stateGidp = 0
    for (const o of opportunities) {
      stateGidp += o.weight * (dpBandWidth(gbWidth, o.bases, o.outs, speedDiff) / RANGE)
    }
    weightedGidp += w * (stateGidp / opportunityWeight)
    totalWeight += w
  }

  if (totalWeight === 0) {
    throw new RangeError('gidpPerOpportunity: no cells have positive weight')
  }
  return weightedGidp / totalWeight
}
