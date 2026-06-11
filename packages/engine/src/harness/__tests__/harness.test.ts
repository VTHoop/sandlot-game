import { describe, expect, it } from 'vitest'
import { computeCell } from '../computeCell'
import {
  aggregateGrid,
  assertAggregate,
  buildArtifact,
  enumerateGrid,
  validateGridInvariants,
} from '../grid'
import { DEFAULT_LINEAR_WEIGHTS } from '../linearWeights'
import type { BaselineConfig, CellDiffs, ToleranceConfig } from '../types'

// ─── Shared fixtures ──────────────────────────────────────────────────────────

const ALL_ZERO: CellDiffs = { powerVel: 0, speedAwa: 0, eyeCmd: 0, contactMov: 0 }

// Pre-compute the full grid once at module level — avoids repeating 14 641
// cell assemblies per test and keeps individual tests fast.
const GRID = enumerateGrid()
const AGGREGATE = aggregateGrid(GRID)

// ─── Width/500 rate identity ───────────────────────────────────────────────────
//
// The circular/shorter-arc fold of two uniform 1–1000 draws is uniform on 0–499.
// (TC: "VERIFY the 0–499 fold before assuming width/500" — confirmed true for the
// circular fold, not raw |X−Y|.)  Therefore rate = band_width / 500.

describe('width/500 rate identity (all-zero diffs)', () => {
  // At diff=0 everywhere the seed tables give deterministic integer widths.
  // From seedTables.ts diff=0 column (index 5):
  //   HR=17, 3B=2, 2B=27, IF1B=6, BB=44, HIT_TOTAL=125 → 1B=125−17−2−27−6=73
  //   K=113, FO=85, PO=35 → GB=500−(17+2+27+73+6+44+85+35+113)=98
  it('HR rate = 17/500', () => {
    expect(computeCell(ALL_ZERO, DEFAULT_LINEAR_WEIGHTS).rates.hr).toBeCloseTo(17 / 500, 10)
  })
  it('3B rate = 2/500', () => {
    expect(computeCell(ALL_ZERO, DEFAULT_LINEAR_WEIGHTS).rates.triple).toBeCloseTo(2 / 500, 10)
  })
  it('2B rate = 27/500', () => {
    expect(computeCell(ALL_ZERO, DEFAULT_LINEAR_WEIGHTS).rates.double).toBeCloseTo(27 / 500, 10)
  })
  it('1B rate = 73/500', () => {
    expect(computeCell(ALL_ZERO, DEFAULT_LINEAR_WEIGHTS).rates.single).toBeCloseTo(73 / 500, 10)
  })
  it('IF1B rate = 6/500', () => {
    expect(computeCell(ALL_ZERO, DEFAULT_LINEAR_WEIGHTS).rates.if1b).toBeCloseTo(6 / 500, 10)
  })
  it('BB rate = 44/500', () => {
    expect(computeCell(ALL_ZERO, DEFAULT_LINEAR_WEIGHTS).rates.bb).toBeCloseTo(44 / 500, 10)
  })
  it('K rate = 113/500', () => {
    expect(computeCell(ALL_ZERO, DEFAULT_LINEAR_WEIGHTS).rates.k).toBeCloseTo(113 / 500, 10)
  })
  it('FO rate = 85/500', () => {
    expect(computeCell(ALL_ZERO, DEFAULT_LINEAR_WEIGHTS).rates.fo).toBeCloseTo(85 / 500, 10)
  })
  it('PO rate = 35/500', () => {
    expect(computeCell(ALL_ZERO, DEFAULT_LINEAR_WEIGHTS).rates.po).toBeCloseTo(35 / 500, 10)
  })
  it('GB rate = 98/500', () => {
    expect(computeCell(ALL_ZERO, DEFAULT_LINEAR_WEIGHTS).rates.gb).toBeCloseTo(98 / 500, 10)
  })
  it('all rates sum to 1.0', () => {
    const r = computeCell(ALL_ZERO, DEFAULT_LINEAR_WEIGHTS).rates
    const sum = r.hr + r.triple + r.double + r.single + r.if1b + r.bb + r.fo + r.po + r.gb + r.k
    expect(sum).toBeCloseTo(1.0, 8)
  })
})

// ─── Slash line definitions (AC-mandated formulas) ────────────────────────────
//
// H = HR+3B+2B+1B+IF1B; PA=1; AB = 1−BB_rate
// AVG = H/AB; OBP = (H+BB)/PA; SLG = total_bases/AB
// HR%/K%/BB% = rate/PA (PA=1, so they equal the raw rate)

describe('slash line — exact formulas at all-zero diffs', () => {
  // H_count/500 = 125/500; AB_count/500 = 456/500
  it('AVG = H/AB = 125/456', () => {
    expect(computeCell(ALL_ZERO, DEFAULT_LINEAR_WEIGHTS).slashLine.avg).toBeCloseTo(125 / 456, 10)
  })

  it('OBP = (H+BB)/PA = 169/500', () => {
    expect(computeCell(ALL_ZERO, DEFAULT_LINEAR_WEIGHTS).slashLine.obp).toBeCloseTo(169 / 500, 10)
  })

  // TB = 4×17 + 3×2 + 2×27 + 1×(73+6) = 68+6+54+79 = 207
  it('SLG = total_bases/AB = 207/456', () => {
    expect(computeCell(ALL_ZERO, DEFAULT_LINEAR_WEIGHTS).slashLine.slg).toBeCloseTo(207 / 456, 10)
  })

  it('HR% = HR/PA = 17/500', () => {
    expect(computeCell(ALL_ZERO, DEFAULT_LINEAR_WEIGHTS).slashLine.hrPct).toBeCloseTo(17 / 500, 10)
  })

  it('K% = K/PA = 113/500', () => {
    expect(computeCell(ALL_ZERO, DEFAULT_LINEAR_WEIGHTS).slashLine.kPct).toBeCloseTo(113 / 500, 10)
  })

  it('BB% = BB/PA = 44/500', () => {
    expect(computeCell(ALL_ZERO, DEFAULT_LINEAR_WEIGHTS).slashLine.bbPct).toBeCloseTo(44 / 500, 10)
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
})

// ─── Full grid enumeration ────────────────────────────────────────────────────

describe('enumerateGrid', () => {
  it('returns at most 14641 cells (11^4)', () => {
    expect(GRID.length).toBeLessThanOrEqual(14641)
  })

  it('returns at least 10000 valid cells (degenerate extremes skipped)', () => {
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
    for (const key of ['avg', 'obp', 'slg', 'hrPct', 'kPct', 'bbPct'] as const) {
      expect(result.perStatDeltas[key]).toHaveProperty('actual')
      expect(result.perStatDeltas[key]).toHaveProperty('baseline')
      expect(result.perStatDeltas[key]).toHaveProperty('delta')
      expect(result.perStatDeltas[key]).toHaveProperty('pass')
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
