// SAN-15 balance derivation + validation.
// Run from workspace root: pnpm derive-balance
//
// Reproduces the tuned aggregate from the committed seed tables and checks it
// against the 2024 MLB tolerance gates. This is the human-auditable companion to
// the CI test: it shows HOW each rate falls out of the seed tables (per-table
// triangular marginal mean) and WHETHER the aggregate lands in every gate.
import {
  MLB_2024_BASELINE,
  MLB_2024_RUNS_PER_GAME,
  MLB_2024_RUNS_PER_GAME_TOLERANCE,
  MLB_2024_TOLERANCE,
} from '../src/harness/baselines'
import {
  aggregateGrid,
  aggregateRunsPerGame,
  assertAggregate,
  enumerateGrid,
  validateEnumeration,
  validateGridInvariants,
} from '../src/harness/grid'
import { DEFAULT_LINEAR_WEIGHTS } from '../src/harness/linearWeights'
import type { OutcomeTable } from '../src/tables/seedTables'
import { BB, DOUBLE, HIT_TOTAL, HR, IF1B, K, TRIPLE } from '../src/tables/seedTables'

// Triangular differential marginal: P(d) = (5−|d|)/25 for |d| ≤ 4, else 0.
// Intentionally re-derived here rather than imported from defaultDistribution: this
// script is an INDEPENDENT audit of the aggregate, so it recomputes the marginal from
// first principles instead of calling the same code path the gate uses. If the canonical
// defaultDistribution.marginalWeight ever changes, this constant must be revisited.
function marginalWeight(d: number): number {
  const abs = Math.abs(d)
  return abs >= 5 ? 0 : (5 - abs) / 25
}

/**
 * Triangular-weighted marginal mean of a seed table.
 * Because the differential weight factorizes across the four dimensions and is
 * symmetric, each aggregate rate equals its table's marginal mean / 500. The
 * d = ±5 ends carry zero weight (unreachable from 1–5 attribute buckets).
 */
function marginalMean(table: OutcomeTable): number {
  let mean = 0
  for (let d = -4; d <= 4; d++) {
    mean += marginalWeight(d) * table[d + 5]
  }
  return mean
}

interface Gate {
  label: string
  actual: number
  baseline: number
  tol: number
  /** Render as a percentage (rates) rather than a 3-decimal ratio (slash line). */
  pct: boolean
}

function fmtGate({ label, actual, baseline, tol, pct }: Gate): string {
  const scale = pct ? 100 : 1
  const unit = pct ? '%' : ''
  const pass = Math.abs(actual - baseline) <= tol
  const digits = pct ? 2 : 3
  return [
    `  ${label.padEnd(5)}`,
    `actual ${(actual * scale).toFixed(digits)}${unit}`.padEnd(16),
    `target ${(baseline * scale).toFixed(digits)} ± ${(tol * scale).toFixed(digits)}${unit}`.padEnd(
      22,
    ),
    pass ? 'PASS' : 'FAIL',
  ].join('  ')
}

const { cells, degenerate } = enumerateGrid(DEFAULT_LINEAR_WEIGHTS)
const agg = aggregateGrid(cells)
const rg = aggregateRunsPerGame(cells, DEFAULT_LINEAR_WEIGHTS)
const assertion = assertAggregate(agg, MLB_2024_BASELINE, MLB_2024_TOLERANCE)
const { leakedPositiveWeight } = validateEnumeration(degenerate)
const invariants = validateGridInvariants(cells)

console.log('── SAN-15 balance derivation ─────────────────────────────────────────')
console.log('Per-table triangular marginal mean (drives each aggregate rate):')
console.log(
  `  HR    ${marginalMean(HR).toFixed(2)}  → HR%  ${((marginalMean(HR) / 500) * 100).toFixed(2)}%`,
)
console.log(
  `  BB    ${marginalMean(BB).toFixed(2)}  → BB%  ${((marginalMean(BB) / 500) * 100).toFixed(2)}%`,
)
console.log(
  `  K     ${marginalMean(K).toFixed(2)}  → K%   ${((marginalMean(K) / 500) * 100).toFixed(2)}%`,
)
console.log(
  `  HITS  ${marginalMean(HIT_TOTAL).toFixed(2)}  → h    ${(marginalMean(HIT_TOTAL) / 500).toFixed(3)}`,
)
console.log(
  `  2B    ${marginalMean(DOUBLE).toFixed(2)}   3B  ${marginalMean(TRIPLE).toFixed(2)}   IF1B ${marginalMean(IF1B).toFixed(2)}`,
)
console.log('')
console.log('Aggregate slash line vs 2024 MLB gates:')
const SLASH_GATES: Gate[] = [
  {
    label: 'AVG',
    actual: agg.avg,
    baseline: MLB_2024_BASELINE.avg,
    tol: MLB_2024_TOLERANCE.avg,
    pct: false,
  },
  {
    label: 'OBP',
    actual: agg.obp,
    baseline: MLB_2024_BASELINE.obp,
    tol: MLB_2024_TOLERANCE.obp,
    pct: false,
  },
  {
    label: 'SLG',
    actual: agg.slg,
    baseline: MLB_2024_BASELINE.slg,
    tol: MLB_2024_TOLERANCE.slg,
    pct: false,
  },
  {
    label: 'HR%',
    actual: agg.hrPct,
    baseline: MLB_2024_BASELINE.hrPct,
    tol: MLB_2024_TOLERANCE.hrPct,
    pct: true,
  },
  {
    label: 'K%',
    actual: agg.kPct,
    baseline: MLB_2024_BASELINE.kPct,
    tol: MLB_2024_TOLERANCE.kPct,
    pct: true,
  },
  {
    label: 'BB%',
    actual: agg.bbPct,
    baseline: MLB_2024_BASELINE.bbPct,
    tol: MLB_2024_TOLERANCE.bbPct,
    pct: true,
  },
]
for (const gate of SLASH_GATES) console.log(fmtGate(gate))
const rgPass = Math.abs(rg - MLB_2024_RUNS_PER_GAME) <= MLB_2024_RUNS_PER_GAME_TOLERANCE
console.log(
  `  R/G    actual ${rg.toFixed(2)}      target ${MLB_2024_RUNS_PER_GAME.toFixed(2)} ± ${MLB_2024_RUNS_PER_GAME_TOLERANCE.toFixed(2)}        ${rgPass ? 'PASS' : 'FAIL'}`,
)
console.log('')
console.log(`Leaked positive-weight degenerate cells: ${leakedPositiveWeight.length}  (must be 0)`)
console.log(`Grid invariant violations:              ${invariants.violations.length}  (must be 0)`)
console.log(`Degenerate cells total (incl. |d|=5):   ${degenerate.length} of 14641`)
console.log('')
const allPass = assertion.pass && rgPass && leakedPositiveWeight.length === 0 && invariants.pass
console.log(allPass ? '✅ ALL GATES PASS' : '❌ GATES NOT MET')
process.exitCode = allPass ? 0 : 1
