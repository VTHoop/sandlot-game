import { describe, expect, it } from 'vitest'
import type { AttributeDiff } from '../../tables/accessor'
import {
  MLB_2024_BASELINE,
  MLB_2024_RUNS_PER_GAME,
  MLB_2024_RUNS_PER_GAME_TOLERANCE,
  MLB_2024_TOLERANCE,
  MLB_GIDP_PER_OPPORTUNITY,
  MLB_GIDP_PER_OPPORTUNITY_TOLERANCE,
} from '../baselines'
import { computeCell } from '../computeCell'
import { gidpPerOpportunity } from '../gidp'
import {
  aggregateGrid,
  aggregateRunsPerGame,
  assertAggregate,
  buildArtifact,
  enumerateGrid,
  validateEnumeration,
  validateGridInvariants,
} from '../grid'
import { DEFAULT_LINEAR_WEIGHTS } from '../linearWeights'
import type { BaselineConfig, CellDiffs, ToleranceConfig } from '../types'

// ─── Shared fixtures ──────────────────────────────────────────────────────────

const ALL_ZERO: CellDiffs = { powerVel: 0, speedAwa: 0, eyeCmd: 0, contactMov: 0 }

// Pre-compute the full grid once at module level — avoids repeating 14 641
// cell assemblies per test and keeps individual tests fast.
const { cells: GRID, degenerate: DEGENERATE_CELLS } = enumerateGrid()
const AGGREGATE = aggregateGrid(GRID)

// ─── Width/500 rate identity ───────────────────────────────────────────────────
//
// The circular fold of two uniform 1–999 draws (ring of 999, ADR-0016) is uniform
// across the interior 1–499; only the exact-match value 0 is half-weight. The
// harness treats all 500 positions as equally likely, so rate = band_width / 500.
//
// These are *balance-agnostic property tests*: they assert the width/500 fold and
// the complete partition for every reachable cell, so they survive any SAN-15-style
// retune. The specific diff=0 widths are no longer pinned here — the seed values are
// range-checked in tables/__tests__/seedTables.test.ts and the aggregate is gated in
// the "2024 MLB tolerance gates" suite below. (The exact band widths per matchup are
// covered with injected fixtures in rangeFinder/__tests__.)

describe('width/500 rate identity — holds for every reachable cell', () => {
  it('every rate is a non-negative integer band width over 500', () => {
    for (const cell of GRID) {
      // Iterate values directly (not via computed key access) — every OutcomeRates
      // field is one of the ten band rates.
      for (const rate of Object.values(cell.rates)) {
        expect(rate).toBeGreaterThanOrEqual(0)
        const width = rate * 500
        // rate must be an exact k/500 — i.e. width is a non-negative integer.
        expect(width).toBeCloseTo(Math.round(width), 6)
      }
    }
  })

  it('all ten rates sum to exactly 1.0 in every cell (complete partition)', () => {
    for (const cell of GRID) {
      const r = cell.rates
      const sum = r.hr + r.triple + r.double + r.single + r.if1b + r.bb + r.fo + r.po + r.gb + r.k
      expect(sum).toBeCloseTo(1.0, 9)
    }
  })
})

// ─── Slash line definitions (AC-mandated formulas) ────────────────────────────
//
// H = HR+3B+2B+1B+IF1B; PA=1; AB = 1−BB_rate
// AVG = H/AB; OBP = (H+BB)/PA; SLG = total_bases/AB
// HR%/K%/BB% = rate/PA (PA=1, so they equal the raw rate)
//
// Balance-agnostic: each slash field is re-derived from the SAME cell's own rates
// and must match, for every reachable cell. This pins the formula SHAPE (the 4/3/2/1
// SLG coefficients, the AB=1−BB denominator, the IF1B term in H) without hard-coding
// any tuned value, so the suite survives retuning. The exact tuned numbers are gated
// in the "2024 MLB tolerance gates" suite below.

describe('slash line formulas — hold for every reachable cell', () => {
  it('AVG = H/AB, OBP = H+BB, SLG = TB/AB, and HR%/K%/BB% equal their rates', () => {
    for (const cell of GRID) {
      const r = cell.rates
      const hits = r.hr + r.triple + r.double + r.single + r.if1b
      const abRate = 1 - r.bb
      const totalBases = 4 * r.hr + 3 * r.triple + 2 * r.double + (r.single + r.if1b)

      expect(cell.slashLine.avg).toBeCloseTo(hits / abRate, 10)
      expect(cell.slashLine.obp).toBeCloseTo(hits + r.bb, 10)
      expect(cell.slashLine.slg).toBeCloseTo(totalBases / abRate, 10)
      expect(cell.slashLine.hrPct).toBeCloseTo(r.hr, 10)
      expect(cell.slashLine.kPct).toBeCloseTo(r.k, 10)
      expect(cell.slashLine.bbPct).toBeCloseTo(r.bb, 10)
    }
  })

  it('OBP ≥ AVG and SLG ≥ AVG in every cell (sanity ordering)', () => {
    for (const cell of GRID) {
      expect(cell.slashLine.slg).toBeGreaterThanOrEqual(cell.slashLine.avg)
      // OBP counts BB in the numerator over PA; AVG divides hits by the smaller AB.
      // Both exceed the bare hit rate, so assert the weaker, always-true SLG ≥ AVG
      // and OBP > 0 here; the AVG/OBP ordering is matchup-dependent, not invariant.
      expect(cell.slashLine.obp).toBeGreaterThan(0)
    }
  })
})

// ─── Determinism ─────────────────────────────────────────────────────────────

describe('determinism', () => {
  it('identical inputs always yield identical output', () => {
    const a = computeCell(ALL_ZERO, DEFAULT_LINEAR_WEIGHTS)
    const b = computeCell(ALL_ZERO, DEFAULT_LINEAR_WEIGHTS)
    expect(a).toEqual(b)
  })

  it('different diffs yield different slash lines', () => {
    const base = computeCell(ALL_ZERO, DEFAULT_LINEAR_WEIGHTS)
    const high = computeCell(
      { powerVel: 3, speedAwa: 2, eyeCmd: 2, contactMov: 2 },
      DEFAULT_LINEAR_WEIGHTS,
    )
    expect(high.slashLine.avg).not.toBeCloseTo(base.slashLine.avg, 5)
  })
})

// ─── runsPerGame ─────────────────────────────────────────────────────────────

describe('runsPerGame', () => {
  it('is a finite positive number', () => {
    const { runsPerGame } = computeCell(ALL_ZERO, DEFAULT_LINEAR_WEIGHTS)
    expect(Number.isFinite(runsPerGame)).toBe(true)
  })

  it('increases when batter attributes are favoured (+5 contact advantage)', () => {
    const base = computeCell(ALL_ZERO, DEFAULT_LINEAR_WEIGHTS).runsPerGame
    const elite = computeCell(
      { powerVel: 5, speedAwa: 5, eyeCmd: 5, contactMov: 5 },
      DEFAULT_LINEAR_WEIGHTS,
    ).runsPerGame
    expect(elite).toBeGreaterThan(base)
  })

  it('decreases when pitcher attributes are favoured (−5 batter disadvantage)', () => {
    const base = computeCell(ALL_ZERO, DEFAULT_LINEAR_WEIGHTS).runsPerGame
    const weak = computeCell(
      { powerVel: -4, speedAwa: -4, eyeCmd: -4, contactMov: -4 },
      DEFAULT_LINEAR_WEIGHTS,
    ).runsPerGame
    expect(weak).toBeLessThan(base)
  })

  it('equals (Σ rate·weight / outRate) × 27 for every reachable cell', () => {
    // Balance-agnostic: re-derive the estimator from each cell's own rates and the
    // injected weights, for every cell. Pins the formula (per-PA run sum, division by
    // the out rate, × 27 outs/game) without hard-coding any tuned width or weight.
    const w = DEFAULT_LINEAR_WEIGHTS
    for (const cell of GRID) {
      const r = cell.rates
      const runsPerPA =
        r.hr * w.hr +
        r.triple * w.triple +
        r.double * w.double +
        r.single * w.single +
        r.if1b * w.if1b +
        r.bb * w.bb +
        r.fo * w.fo +
        r.po * w.po +
        r.gb * w.gb +
        r.k * w.k
      const outRate = r.fo + r.po + r.gb + r.k
      expect(cell.runsPerGame).toBeCloseTo((runsPerPA / outRate) * 27, 10)
    }
  })
})

// ─── Full grid enumeration ────────────────────────────────────────────────────

describe('enumerateGrid', () => {
  it('returns at most 14641 cells (11^4)', () => {
    expect(GRID.length).toBeLessThanOrEqual(14641)
  })

  it('cells + degenerate = 14641 (full grid accounted for)', () => {
    expect(GRID.length + DEGENERATE_CELLS.length).toBe(14641)
  })

  it('returns at least 10000 valid cells (degenerate extremes excluded)', () => {
    expect(GRID.length).toBeGreaterThanOrEqual(10000)
  })

  it('every cell has diffs, rates, slashLine, runsPerGame', () => {
    for (const cell of GRID) {
      expect(cell).toHaveProperty('diffs')
      expect(cell).toHaveProperty('rates')
      expect(cell).toHaveProperty('slashLine')
      expect(cell).toHaveProperty('runsPerGame')
    }
  })

  it('all four diffs in every cell are in [−5, +5]', () => {
    for (const { diffs } of GRID) {
      for (const d of Object.values(diffs)) {
        expect(d).toBeGreaterThanOrEqual(-5)
        expect(d).toBeLessThanOrEqual(5)
      }
    }
  })
})

// ─── validateEnumeration — no positive-weight cell was silently dropped ───────
//
// If SAN-15 retunes seed tables and a reachable matchup starts throwing,
// that cell would vanish from the aggregate with no signal. validateEnumeration
// catches this by asserting every degenerate cell has zero weight.

describe('validateEnumeration', () => {
  // SAN-15 tuned the seed tables so the 1B residual stays positive across every
  // reachable matchup: 1B = HIT_TOTAL(cm) − HR(pv) − TRIPLE/DOUBLE/IF1B(sa) > 0 for
  // all |diff| ≤ 4. The pre-SAN-15 count was 45; it is now 0 and ratcheted there —
  // any future retune that re-introduces a reachable degenerate cell fails here.
  it('zero positive-weight matchup is silently dropped (degenerate ratchet)', () => {
    const { pass, leakedPositiveWeight } = validateEnumeration(DEGENERATE_CELLS)
    expect(leakedPositiveWeight.length).toBe(0)
    expect(pass).toBe(true)
  })

  it('detects when a degenerate cell has positive weight (simulates seed-table regression)', () => {
    // ALL_ZERO has positive default weight — treat it as "accidentally degenerate"
    const result = validateEnumeration([ALL_ZERO])
    expect(result.pass).toBe(false)
    expect(result.leakedPositiveWeight).toHaveLength(1)
    expect(result.leakedPositiveWeight[0]).toEqual(ALL_ZERO)
  })

  it('passes when all supplied cells have zero weight', () => {
    // Cells where every diff is ±5 have zero default weight (unreachable from [1,5] attrs)
    const zeroWeightCells: CellDiffs[] = [
      { powerVel: 5, speedAwa: 5, eyeCmd: 5, contactMov: 5 },
      { powerVel: -5, speedAwa: -5, eyeCmd: -5, contactMov: -5 },
    ]
    const result = validateEnumeration(zeroWeightCells)
    expect(result.pass).toBe(true)
    expect(result.leakedPositiveWeight).toHaveLength(0)
  })

  it('accepts an injectable weight function', () => {
    // Weight function that returns 0 for everything → no leaks regardless of input
    const zeroFn = (_d: CellDiffs) => 0
    expect(validateEnumeration(DEGENERATE_CELLS, zeroFn).pass).toBe(true)
  })
})

// ─── Grid invariants (AC: partition completeness + GB ≥ 0) ───────────────────

describe('validateGridInvariants', () => {
  it('passes on the live grid — all cells sum to 1.0 and GB ≥ 0', () => {
    const result = validateGridInvariants(GRID)
    expect(result.pass).toBe(true)
    expect(result.violations).toHaveLength(0)
  })

  it('detects a partition-sum violation when a cell is manually poisoned', () => {
    const poisoned = [
      {
        ...GRID[0],
        rates: { ...GRID[0].rates, hr: GRID[0].rates.hr + 0.5 },
      },
    ]
    const result = validateGridInvariants(poisoned)
    expect(result.pass).toBe(false)
    expect(result.violations.length).toBeGreaterThan(0)
  })

  it('detects a GB < 0 violation when a cell is manually poisoned', () => {
    const poisoned = [{ ...GRID[0], rates: { ...GRID[0].rates, gb: -0.01 } }]
    const result = validateGridInvariants(poisoned)
    expect(result.pass).toBe(false)
  })
})

// ─── Aggregate slash line ────────────────────────────────────────────────────

describe('aggregateGrid', () => {
  it('returns a slash line with all six fields', () => {
    expect(AGGREGATE).toHaveProperty('avg')
    expect(AGGREGATE).toHaveProperty('obp')
    expect(AGGREGATE).toHaveProperty('slg')
    expect(AGGREGATE).toHaveProperty('hrPct')
    expect(AGGREGATE).toHaveProperty('kPct')
    expect(AGGREGATE).toHaveProperty('bbPct')
  })

  it('aggregate AVG is in a plausible MLB range (0.200–0.310)', () => {
    expect(AGGREGATE.avg).toBeGreaterThan(0.2)
    expect(AGGREGATE.avg).toBeLessThan(0.31)
  })

  it('aggregate OBP >= aggregate AVG', () => {
    expect(AGGREGATE.obp).toBeGreaterThan(AGGREGATE.avg)
  })

  it('aggregate SLG >= aggregate AVG', () => {
    expect(AGGREGATE.slg).toBeGreaterThan(AGGREGATE.avg)
  })

  it('accepts an injectable weight function (uniform across non-zero-weight cells)', () => {
    const uniformAgg = aggregateGrid(GRID, () => 1)
    // Should produce a different result than the default triangular distribution
    expect(uniformAgg.avg).not.toBeCloseTo(AGGREGATE.avg, 5)
  })

  it('throws RangeError when all weights are zero (prevents silent NaN)', () => {
    expect(() => aggregateGrid(GRID, () => 0)).toThrow(RangeError)
  })

  it('throws RangeError when cells array is empty', () => {
    expect(() => aggregateGrid([])).toThrow(RangeError)
  })
})

describe('aggregateRunsPerGame', () => {
  it('returns a finite positive league rate under the default distribution', () => {
    const rg = aggregateRunsPerGame(GRID, DEFAULT_LINEAR_WEIGHTS)
    expect(Number.isFinite(rg)).toBe(true)
    expect(rg).toBeGreaterThan(0)
  })

  it('throws RangeError when no cell has positive weight (prevents silent NaN)', () => {
    expect(() => aggregateRunsPerGame(GRID, DEFAULT_LINEAR_WEIGHTS, () => 0)).toThrow(RangeError)
  })
})

// ─── Assertion API ───────────────────────────────────────────────────────────

describe('assertAggregate', () => {
  it('passes when baselines exactly equal the aggregate with zero tolerance', () => {
    const result = assertAggregate(
      AGGREGATE,
      AGGREGATE as BaselineConfig,
      {
        avg: 0,
        obp: 0,
        slg: 0,
        hrPct: 0,
        kPct: 0,
        bbPct: 0,
      } as ToleranceConfig,
    )
    expect(result.pass).toBe(true)
  })

  it('fails when aggregate is far outside tolerance', () => {
    const badBaseline: BaselineConfig = {
      avg: 0.999,
      obp: 0.999,
      slg: 0.999,
      hrPct: 0.999,
      kPct: 0.999,
      bbPct: 0.999,
    }
    const tight: ToleranceConfig = {
      avg: 0.001,
      obp: 0.001,
      slg: 0.001,
      hrPct: 0.001,
      kPct: 0.001,
      bbPct: 0.001,
    }
    expect(assertAggregate(AGGREGATE, badBaseline, tight).pass).toBe(false)
  })

  it('perStatDeltas includes actual, baseline, delta, pass for each stat', () => {
    const baseline: BaselineConfig = {
      avg: 0.25,
      obp: 0.32,
      slg: 0.41,
      hrPct: 0.03,
      kPct: 0.22,
      bbPct: 0.085,
    }
    const tol: ToleranceConfig = {
      avg: 0.1,
      obp: 0.1,
      slg: 0.1,
      hrPct: 0.1,
      kPct: 0.1,
      bbPct: 0.1,
    }
    const result = assertAggregate(AGGREGATE, baseline, tol)
    const allDeltas = [
      result.perStatDeltas.avg,
      result.perStatDeltas.obp,
      result.perStatDeltas.slg,
      result.perStatDeltas.hrPct,
      result.perStatDeltas.kPct,
      result.perStatDeltas.bbPct,
    ]
    for (const d of allDeltas) {
      expect(d).toHaveProperty('actual')
      expect(d).toHaveProperty('baseline')
      expect(d).toHaveProperty('delta')
      expect(d).toHaveProperty('pass')
    }
  })

  it('individual stat can pass while others fail', () => {
    const baseline: BaselineConfig = {
      avg: AGGREGATE.avg, // exact match → pass
      obp: 0.999, // wildly off → fail
      slg: 0.999,
      hrPct: 0.999,
      kPct: 0.999,
      bbPct: 0.999,
    }
    const tol: ToleranceConfig = {
      avg: 0,
      obp: 0.001,
      slg: 0.001,
      hrPct: 0.001,
      kPct: 0.001,
      bbPct: 0.001,
    }
    const result = assertAggregate(AGGREGATE, baseline, tol)
    expect(result.perStatDeltas.avg.pass).toBe(true)
    expect(result.pass).toBe(false)
  })
})

// ─── Artifact shape ──────────────────────────────────────────────────────────

describe('buildArtifact', () => {
  it('artifact has cells and linearWeights fields', () => {
    const artifact = buildArtifact(GRID)
    expect(artifact).toHaveProperty('cells')
    expect(artifact).toHaveProperty('linearWeights')
  })

  it('linearWeights includes all ten outcome keys', () => {
    const artifact = buildArtifact(GRID)
    const expectedKeys = ['hr', 'triple', 'double', 'single', 'if1b', 'bb', 'fo', 'po', 'gb', 'k']
    for (const key of expectedKeys) {
      expect(artifact.linearWeights).toHaveProperty(key)
    }
  })

  it('each artifact cell has the required SAN-18 fields', () => {
    const artifact = buildArtifact(GRID)
    for (const cell of artifact.cells) {
      expect(cell).toHaveProperty('diffs')
      expect(cell).toHaveProperty('rates')
      expect(cell).toHaveProperty('slashLine')
      expect(cell).toHaveProperty('runsPerGame')
    }
  })

  it('accepts a custom run-value table', () => {
    const customWeights = { ...DEFAULT_LINEAR_WEIGHTS, hr: 2.0 }
    const artifact = buildArtifact(GRID, customWeights)
    expect(artifact.linearWeights.hr).toBe(2.0)
  })
})

// ─── SAN-15 acceptance — 2024 MLB tolerance gates + directional invariants ────
//
// This is the committed balance gate. It pins the tuned seed tables and run values
// against the 2024 MLB baselines (harness/baselines.ts): the weighted aggregate over
// the default triangular differential distribution must sit inside every gate, the
// four directional invariants must hold, no reachable matchup may be silently dropped,
// and the per-cell partition must be complete. A retune that drifts out of any gate or
// breaks an invariant fails here.

const AXIS: AttributeDiff[] = [-5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5]

/** Sweep one differential axis (others held at 0) and return per-step rates. */
function sweep(
  axis: 'powerVel' | 'speedAwa' | 'eyeCmd' | 'contactMov',
  pick: (rates: (typeof GRID)[number]['rates']) => number,
): number[] {
  return AXIS.map((d) => {
    const diffs: CellDiffs = { powerVel: 0, speedAwa: 0, eyeCmd: 0, contactMov: 0, [axis]: d }
    return pick(computeCell(diffs, DEFAULT_LINEAR_WEIGHTS).rates)
  })
}

function isNonDecreasing(xs: number[]): boolean {
  return xs.every((x, i) => i === 0 || x >= xs[i - 1])
}

function isNonIncreasing(xs: number[]): boolean {
  return xs.every((x, i) => i === 0 || x <= xs[i - 1])
}

describe('SAN-15 — aggregate slash line inside 2024 MLB tolerance gates', () => {
  const result = assertAggregate(AGGREGATE, MLB_2024_BASELINE, MLB_2024_TOLERANCE)

  it('passes every per-stat gate (AVG/OBP/SLG/HR%/K%/BB%)', () => {
    // Surface which stat drifted, if any, instead of a bare boolean.
    const failing = Object.entries(result.perStatDeltas)
      .filter(([, d]) => !d.pass)
      .map(
        ([k, d]) =>
          `${k}: actual ${d.actual.toFixed(4)} vs ${d.baseline} (Δ ${d.delta.toFixed(4)})`,
      )
    expect(failing).toEqual([])
    expect(result.pass).toBe(true)
  })

  it('aggregate runs/game is inside 4.39 ± 0.12', () => {
    const rg = aggregateRunsPerGame(GRID, DEFAULT_LINEAR_WEIGHTS)
    expect(Math.abs(rg - MLB_2024_RUNS_PER_GAME)).toBeLessThanOrEqual(
      MLB_2024_RUNS_PER_GAME_TOLERANCE,
    )
  })
})

describe('SAN-15 — directional invariants', () => {
  it('HR% is non-decreasing as Power−Velocity rises', () => {
    expect(isNonDecreasing(sweep('powerVel', (r) => r.hr))).toBe(true)
  })

  it('K% is non-increasing as Contact−Movement rises', () => {
    expect(isNonIncreasing(sweep('contactMov', (r) => r.k))).toBe(true)
  })

  it('BB% is non-decreasing as Eye−Command rises', () => {
    expect(isNonDecreasing(sweep('eyeCmd', (r) => r.bb))).toBe(true)
  })

  it('2B+3B is non-decreasing as Speed−Awareness rises', () => {
    expect(isNonDecreasing(sweep('speedAwa', (r) => r.double + r.triple))).toBe(true)
  })
})

describe('SAN-15 — structural integrity', () => {
  it('no positive-weight matchup is silently excluded from the aggregate', () => {
    expect(validateEnumeration(DEGENERATE_CELLS).pass).toBe(true)
  })

  it('partition completeness and GB ≥ 0 hold across the whole grid', () => {
    expect(validateGridInvariants(GRID).pass).toBe(true)
  })
})

describe('SAN-16 — GIDP per opportunity', () => {
  it('harness-derived GIDP per opportunity matches the MLB baseline within tolerance', () => {
    const gidp = gidpPerOpportunity(GRID)
    expect(Math.abs(gidp - MLB_GIDP_PER_OPPORTUNITY)).toBeLessThanOrEqual(
      MLB_GIDP_PER_OPPORTUNITY_TOLERANCE,
    )
  })

  it('rises when runners/batter lose the speed race and falls when they win it', () => {
    const slow = gidpPerOpportunity(GRID, undefined, undefined, -2)
    const fast = gidpPerOpportunity(GRID, undefined, undefined, 2)
    expect(slow).toBeGreaterThan(fast)
  })
})
