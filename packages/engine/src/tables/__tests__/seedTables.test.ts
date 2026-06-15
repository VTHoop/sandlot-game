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
    // (Updated by SAN-15: seed tables retuned so the weighted aggregate lands in the
    // 2024 MLB tolerance gates — see ADR-0015 and `pnpm derive-balance`.)
    expect(total).toBe(7538)
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
    // At the unreachable |diff|=5 corner: contactMov=-5 → HIT_TOTAL=66; powerVel=+5 →
    // HR=32; speedAwa=+5 → TRIPLE=8, DOUBLE=31, IF1B=12 → XBH sum=83 > 66, so 1B clamps
    // to 0. (This corner has zero differential weight; reachable |diff|≤4 cells keep 1B>0.)
    expect(getSingle({ contactMov: -5, powerVel: 5, speedAwa: 5 })).toBe(0)
  })
})

// ─── Accessor: diff=0 anchor sanity bounds ────────────────────────────────────
//
// These bound the diff=0 ANCHOR of each table, not the league average — after the
// SAN-15 retune the league rate is the weighted AGGREGATE (gated in harness.test.ts),
// not the diff=0 cell. The ranges are loose sanity bounds centered on the tuned
// anchor that catch a gross typo in the anchor column; exact balance lives in the
// aggregate gate. (See seedTables.ts header and ADR-0015.)

describe('accessor diff-0 anchor sanity bounds', () => {
  it('getHr(0) anchor ≈ 15 (aggregate HR% ≈ 3.1%, gated separately)', () => {
    expect(getHr(0)).toBeGreaterThanOrEqual(10)
    expect(getHr(0)).toBeLessThanOrEqual(20)
  })

  it('getBb(0) anchor ≈ 41 (aggregate BB% ≈ 8.5%, gated separately)', () => {
    expect(getBb(0)).toBeGreaterThanOrEqual(31)
    expect(getBb(0)).toBeLessThanOrEqual(51)
  })

  it('getK(0) anchor ≈ 113 (aggregate K% ≈ 22.8%, gated separately)', () => {
    expect(getK(0)).toBeGreaterThanOrEqual(98)
    expect(getK(0)).toBeLessThanOrEqual(128)
  })

  it('getHitTotal(0) anchor ≈ 111 (drives aggregate AVG/OBP, gated separately)', () => {
    expect(getHitTotal(0)).toBeGreaterThanOrEqual(96)
    expect(getHitTotal(0)).toBeLessThanOrEqual(126)
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
