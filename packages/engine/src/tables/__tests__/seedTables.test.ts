import { describe, expect, it } from 'vitest'
import { getBb, getHandSwitcher, getHitTotal, getHr, getK, getSingle } from '../accessor'
import type { OutcomeTable } from '../seedTables'
import { BB, DOUBLE, HAND_OPPOSITE, HAND_SAME, HIT_TOTAL, HR, IF1B, K, TRIPLE } from '../seedTables'

const ALL_TABLES: Record<string, OutcomeTable> = {
  HR,
  TRIPLE,
  DOUBLE,
  IF1B,
  BB,
  HIT_TOTAL,
  K,
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
    for (let i = 0; i < table.length - 1; i++) {
      expect(table[i]).toBeLessThanOrEqual(table[i + 1])
    }
  })

  it('K is non-increasing across differentials -5..+5', () => {
    for (let i = 0; i < K.length - 1; i++) {
      expect(K[i]).toBeGreaterThanOrEqual(K[i + 1])
    }
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
    expect(total).toBe(6625)
  })
})

// ─── Accessor: clamping ───────────────────────────────────────────────────────

describe('accessor clamping', () => {
  it('getHr clamps inputs below -5 to -5', () => {
    expect(getHr(-10)).toBe(getHr(-5))
  })

  it('getHr clamps inputs above +5 to +5', () => {
    expect(getHr(10)).toBe(getHr(5))
  })

  it('getBb clamps at both ends', () => {
    expect(getBb(-99)).toBe(getBb(-5))
    expect(getBb(99)).toBe(getBb(5))
  })

  it('getK clamps at both ends', () => {
    expect(getK(-99)).toBe(getK(-5))
    expect(getK(99)).toBe(getK(5))
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
    expect(getSingle(0, 0, 0)).toBeGreaterThan(0)
  })

  it('getHandSwitcher opposite > same at diff=0 (platoon advantage for batter)', () => {
    expect(getHandSwitcher('opposite', 0)).toBeGreaterThan(getHandSwitcher('same', 0))
  })
})
