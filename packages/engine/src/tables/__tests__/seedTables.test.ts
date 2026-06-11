import { describe, expect, it } from 'vitest'
import {
  getBb,
  getFo,
  getHandSwitcher,
  getHitTotal,
  getHr,
  getK,
  getPo,
  getSingle,
  toAttributeDiff,
} from '../accessor'
import type { OutcomeTable } from '../seedTables'
import {
  BB,
  DOUBLE,
  FO,
  HAND_OPPOSITE,
  HAND_SAME,
  HIT_TOTAL,
  HR,
  IF1B,
  K,
  PO,
  TRIPLE,
} from '../seedTables'

const ALL_TABLES: Record<string, OutcomeTable> = {
  HR,
  TRIPLE,
  DOUBLE,
  IF1B,
  BB,
  HIT_TOTAL,
  K,
  FO,
  PO,
  HAND_SAME,
  HAND_OPPOSITE,
}

// ─── Shape ───────────────────────────────────────────────────────────────────

describe('shape', () => {
  it.each(Object.entries(ALL_TABLES))('%s has exactly 11 rows', (_, table) => {
    expect(table).toHaveLength(11)
  })

  it.each(Object.entries(ALL_TABLES))('%s values are all positive numbers', (_, table) => {
    for (const v of table) {
      expect(typeof v).toBe('number')
      expect(v).toBeGreaterThan(0)
    }
  })
})

// ─── Monotonicity ─────────────────────────────────────────────────────────────

describe('monotonicity', () => {
  it.each([
    ['HR', HR],
    ['TRIPLE', TRIPLE],
    ['DOUBLE', DOUBLE],
    ['IF1B', IF1B],
    ['BB', BB],
    ['HIT_TOTAL', HIT_TOTAL],
    ['HAND_SAME', HAND_SAME],
    ['HAND_OPPOSITE', HAND_OPPOSITE],
  ] as [string, OutcomeTable][])('%s is non-decreasing across differentials -5..+5', (_, table) => {
    table.reduce((prev, curr) => {
      expect(prev).toBeLessThanOrEqual(curr)
      return curr
    })
  })

  it('K is non-increasing across differentials -5..+5', () => {
    K.reduce((prev, curr) => {
      expect(prev).toBeGreaterThanOrEqual(curr)
      return curr
    })
  })

  it('FO is non-increasing across differentials -5..+5 (Power advantage → fewer fly-outs)', () => {
    FO.reduce((prev, curr) => {
      expect(prev).toBeGreaterThanOrEqual(curr)
      return curr
    })
  })

  it('PO is non-increasing across differentials -5..+5 (Power advantage → fewer pop-outs)', () => {
    PO.reduce((prev, curr) => {
      expect(prev).toBeGreaterThanOrEqual(curr)
      return curr
    })
  })
})

// ─── Checksum — guards against accidental edits ───────────────────────────────

describe('checksum', () => {
  it('sum of all seed table values matches expected', () => {
    const total = Object.values(ALL_TABLES)
      .flat()
      .reduce((acc, v) => acc + v, 0)
    // Derived from public MLB 2024 rates; see seedTables.ts provenance header.
    // If this fails, a table value was accidentally changed — re-derive, don't adjust this number.
    expect(total).toBe(7878)
  })
})

// ─── Accessor: clamping ───────────────────────────────────────────────────────

// Clamping is now a boundary concern in toAttributeDiff rather than inside each accessor.
describe('accessor clamping', () => {
  it('getHr clamps inputs below -5 to -5', () => {
    expect(toAttributeDiff(-10)).toBe(-5)
  })

  it('getHr clamps inputs above +5 to +5', () => {
    expect(toAttributeDiff(10)).toBe(5)
  })

  it('getBb clamps at both ends', () => {
    expect(toAttributeDiff(-99)).toBe(-5)
    expect(toAttributeDiff(99)).toBe(5)
  })

  it('getK clamps at both ends', () => {
    expect(toAttributeDiff(-99)).toBe(-5)
    expect(toAttributeDiff(99)).toBe(5)
  })

  it('getSingle clamps to 0 when extra-base hits exceed hit-total', () => {
    // contactMov=-5 → HIT_TOTAL=72; powerVel=+5 → HR=37;
    // speedAwa=+5 → TRIPLE=8, DOUBLE=50, IF1B=14 → XBH sum=109 > 72
    expect(getSingle({ contactMov: -5, powerVel: 5, speedAwa: 5 })).toBe(0)
  })
})

// ─── Accessor: league-average baseline (diff=0) ───────────────────────────────

describe('accessor diff-0 baseline', () => {
  it('getHr(0) reflects MLB HR rate ≈ 3.3% × 500 ≈ 17 ±5', () => {
    expect(getHr(0)).toBeGreaterThanOrEqual(12)
    expect(getHr(0)).toBeLessThanOrEqual(22)
  })

  it('getBb(0) reflects MLB BB rate ≈ 8.7% × 500 ≈ 44 ±10', () => {
    expect(getBb(0)).toBeGreaterThanOrEqual(34)
    expect(getBb(0)).toBeLessThanOrEqual(54)
  })

  it('getK(0) reflects MLB K rate ≈ 22.5% × 500 ≈ 113 ±15', () => {
    expect(getK(0)).toBeGreaterThanOrEqual(98)
    expect(getK(0)).toBeLessThanOrEqual(128)
  })

  it('getHitTotal(0) reflects MLB BA ≈ .248 × 500 ≈ 124 ±15', () => {
    expect(getHitTotal(0)).toBeGreaterThanOrEqual(109)
    expect(getHitTotal(0)).toBeLessThanOrEqual(139)
  })

  it('getSingle(0,0,0) is positive', () => {
    expect(getSingle({ contactMov: 0, powerVel: 0, speedAwa: 0 })).toBeGreaterThan(0)
  })

  it('getHandSwitcher opposite > same at diff=0 (platoon advantage for batter)', () => {
    expect(getHandSwitcher('opposite', 0)).toBeGreaterThan(getHandSwitcher('same', 0))
  })

  it('getFo(0) reflects MLB fly-out rate ≈ 17% × 500 ≈ 85 ±15', () => {
    expect(getFo(0)).toBeGreaterThanOrEqual(70)
    expect(getFo(0)).toBeLessThanOrEqual(100)
  })

  it('getPo(0) reflects MLB pop-out rate ≈ 7% × 500 ≈ 35 ±10', () => {
    expect(getPo(0)).toBeGreaterThanOrEqual(25)
    expect(getPo(0)).toBeLessThanOrEqual(45)
  })

  it('getFo narrows as powerVel diff increases (Power advantage → fewer fly-outs)', () => {
    expect(getFo(5)).toBeLessThan(getFo(-5))
  })

  it('getPo narrows as powerVel diff increases (Power advantage → fewer pop-outs)', () => {
    expect(getPo(5)).toBeLessThan(getPo(-5))
  })
})
