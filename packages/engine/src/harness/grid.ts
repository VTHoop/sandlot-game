import type { AttributeDiff } from '../tables/accessor'
import { computeCell } from './computeCell'
import { defaultDifferentialWeight } from './defaultDistribution'
import { DEFAULT_LINEAR_WEIGHTS } from './linearWeights'
import type {
  AssertionResult,
  BaselineConfig,
  CellDiffs,
  CellResult,
  DifferentialWeightFn,
  GridArtifact,
  RunValues,
  SlashLine,
  StatKey,
  ToleranceConfig,
} from './types'

const DIFFS = [-5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5] as AttributeDiff[]

// Pre-flattened 4-D diff combinations to avoid nested loops inside functions
// (avoids the Deep Nested Complexity CodeScene finding).
const ALL_DIFFS: CellDiffs[] = DIFFS.flatMap((powerVel) =>
  DIFFS.flatMap((speedAwa) =>
    DIFFS.flatMap((eyeCmd) =>
      DIFFS.map((contactMov) => ({ powerVel, speedAwa, eyeCmd, contactMov })),
    ),
  ),
)

export interface EnumerationResult {
  cells: CellResult[]
  /** Cells that threw during assembly (1B ≤ 0 or GB ≤ 0). */
  degenerate: CellDiffs[]
}

/**
 * Enumerate every cell in the 4-D differential grid and compute exact stats.
 * Degenerate cells (1B ≤ 0 or GB ≤ 0) are collected in `degenerate` rather than
 * silently discarded — callers can verify via validateEnumeration that no
 * positive-weight matchup was dropped (important when SAN-15 retunes seed tables).
 */
export function enumerateGrid(weights: RunValues = DEFAULT_LINEAR_WEIGHTS): EnumerationResult {
  const cells: CellResult[] = []
  const degenerate: CellDiffs[] = []
  for (const diffs of ALL_DIFFS) {
    try {
      cells.push(computeCell(diffs, weights))
    } catch {
      degenerate.push(diffs)
    }
  }
  return { cells, degenerate }
}

/**
 * Assert that every degenerate (skipped) cell has zero weight under weightFn.
 * A positive-weight cell in the degenerate list signals a seed-table regression:
 * a reachable matchup is broken and has been silently excluded from the aggregate.
 */
export function validateEnumeration(
  degenerate: CellDiffs[],
  weightFn: DifferentialWeightFn = defaultDifferentialWeight,
): { pass: boolean; leakedPositiveWeight: CellDiffs[] } {
  const leakedPositiveWeight = degenerate.filter((d) => weightFn(d) > 0)
  return { pass: leakedPositiveWeight.length === 0, leakedPositiveWeight }
}

/** Weighted aggregate slash line across all grid cells. */
export function aggregateGrid(
  cells: CellResult[],
  weightFn: DifferentialWeightFn = defaultDifferentialWeight,
): SlashLine {
  let totalWeight = 0
  let avg = 0
  let obp = 0
  let slg = 0
  let hrPct = 0
  let kPct = 0
  let bbPct = 0

  for (const cell of cells) {
    const w = weightFn(cell.diffs)
    if (w <= 0) continue
    totalWeight += w
    avg += w * cell.slashLine.avg
    obp += w * cell.slashLine.obp
    slg += w * cell.slashLine.slg
    hrPct += w * cell.slashLine.hrPct
    kPct += w * cell.slashLine.kPct
    bbPct += w * cell.slashLine.bbPct
  }

  if (totalWeight === 0) {
    throw new RangeError(
      'aggregateGrid: no cells have positive weight — check cells array and weightFn',
    )
  }

  return {
    avg: avg / totalWeight,
    obp: obp / totalWeight,
    slg: slg / totalWeight,
    hrPct: hrPct / totalWeight,
    kPct: kPct / totalWeight,
    bbPct: bbPct / totalWeight,
  }
}

/**
 * Assert the aggregate slash line against configurable MLB baselines.
 * Baselines and tolerances are inputs — never hardcoded here (SAN-15 owns tuning).
 */
export function assertAggregate(
  aggregate: SlashLine,
  baselines: BaselineConfig,
  tolerances: ToleranceConfig,
): AssertionResult {
  const keys: StatKey[] = ['avg', 'obp', 'slg', 'hrPct', 'kPct', 'bbPct']
  let allPass = true
  const perStatDeltas = {} as AssertionResult['perStatDeltas']

  for (const key of keys) {
    const actual = aggregate[key]
    const baseline = baselines[key]
    const delta = actual - baseline
    const pass = Math.abs(delta) <= tolerances[key]
    if (!pass) allPass = false
    perStatDeltas[key] = { actual, baseline, delta, pass }
  }

  return { pass: allPass, perStatDeltas }
}

/**
 * Validate partition completeness and the SAN-13 GB ≥ 0 invariant across all cells.
 * Returns pass/fail and a list of human-readable violation descriptions.
 */
export function validateGridInvariants(cells: CellResult[]): {
  pass: boolean
  violations: string[]
} {
  const violations: string[] = []

  for (const cell of cells) {
    const r = cell.rates
    const rateSum = r.hr + r.triple + r.double + r.single + r.if1b + r.bb + r.fo + r.po + r.gb + r.k
    if (Math.abs(rateSum - 1.0) > 1e-8) {
      violations.push(`partition sum ${rateSum.toFixed(12)} at ${JSON.stringify(cell.diffs)}`)
    }
    if (cell.rates.gb < 0) {
      violations.push(`GB rate ${cell.rates.gb} < 0 at ${JSON.stringify(cell.diffs)}`)
    }
  }

  return { pass: violations.length === 0, violations }
}

/** Assemble the machine-readable artifact for SAN-18 consumption. */
export function buildArtifact(
  cells: CellResult[],
  weights: RunValues = DEFAULT_LINEAR_WEIGHTS,
): GridArtifact {
  return { cells, linearWeights: weights }
}
