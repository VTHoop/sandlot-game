import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { BackHalfAccessors, BackHalfBands } from '../backHalf'
import { assembleBackHalf } from '../backHalf'
import { assembleFrontHalf } from '../frontHalf'

// ─── Frozen test tables ───────────────────────────────────────────────────────
// Stable, simple values injected into the assembler for exact-boundary tests.
// Never change these; SAN-15 retuning touches seedTables.ts, not these.
// Indexed by diff+5 (index 0 = diff -5, index 10 = diff +5).

const FZ_FO = [10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10] as const
const FZ_PO = [5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5] as const
const FZ_K = [30, 28, 26, 24, 22, 20, 18, 16, 14, 12, 10] as const

function clampIdx(diff: number): number {
  return Math.max(-5, Math.min(5, diff)) + 5
}

const frozenAccessors = {
  getFo: (d: number) => FZ_FO[clampIdx(d)],
  getPo: (d: number) => FZ_PO[clampIdx(d)],
  getK: (d: number) => FZ_K[clampIdx(d)],
} satisfies BackHalfAccessors

const FIXED_BB_HI_PLUS_ONE = 100

function expectedFrozenBands(powerVel: number, contactMov: number): BackHalfBands {
  const foWidth = FZ_FO[clampIdx(powerVel)]
  const poWidth = FZ_PO[clampIdx(powerVel)]
  const kWidth = FZ_K[clampIdx(contactMov)]

  const foLo = FIXED_BB_HI_PLUS_ONE
  const foHi = foLo + foWidth - 1
  const poLo = foHi + 1
  const poHi = poLo + poWidth - 1
  const kLo = 499 - kWidth + 1
  const kHi = 499
  const gbLo = poHi + 1
  const gbHi = kLo - 1

  return {
    FO: { lo: foLo, hi: foHi },
    PO: { lo: poLo, hi: poHi },
    GB: { lo: gbLo, hi: gbHi },
    K: { lo: kLo, hi: kHi },
  }
}

// ─── Band order ───────────────────────────────────────────────────────────────

describe('band order', () => {
  it('result has all four back-half band keys in the correct order', () => {
    const bands = assembleBackHalf(
      { powerVel: 0, contactMov: 0 },
      FIXED_BB_HI_PLUS_ONE,
      frozenAccessors,
    )
    expect(Object.keys(bands)).toEqual(['FO', 'PO', 'GB', 'K'])
  })
})

// ─── K right-anchored at 499 ──────────────────────────────────────────────────

describe('K right-anchor', () => {
  for (let d = -5; d <= 5; d++) {
    it(`K.hi = 499 at differential ${d >= 0 ? `+${d}` : d}`, () => {
      const bands = assembleBackHalf(
        { powerVel: d, contactMov: d },
        FIXED_BB_HI_PLUS_ONE,
        frozenAccessors,
      )
      expect(bands.K.hi).toBe(499)
    })
  }
})

// ─── Partition coverage ───────────────────────────────────────────────────────

describe('partition coverage', () => {
  it('FO starts at bbHiPlusOne', () => {
    const bands = assembleBackHalf(
      { powerVel: 0, contactMov: 0 },
      FIXED_BB_HI_PLUS_ONE,
      frozenAccessors,
    )
    expect(bands.FO.lo).toBe(FIXED_BB_HI_PLUS_ONE)
  })

  it('each band lo = previous band hi + 1 (no gaps, no overlaps)', () => {
    const bands = assembleBackHalf(
      { powerVel: 0, contactMov: 0 },
      FIXED_BB_HI_PLUS_ONE,
      frozenAccessors,
    )
    const entries = Object.values(bands)
    for (let i = 1; i < entries.length; i++) {
      expect(entries[i].lo).toBe(entries[i - 1].hi + 1)
    }
  })

  it('last band ends at 499', () => {
    const bands = assembleBackHalf(
      { powerVel: 0, contactMov: 0 },
      FIXED_BB_HI_PLUS_ONE,
      frozenAccessors,
    )
    const entries = Object.values(bands)
    expect(entries[entries.length - 1].hi).toBe(499)
  })
})

// ─── GB non-negative (frozen tables) ─────────────────────────────────────────

describe('GB non-negative (frozen tables)', () => {
  for (let d = -5; d <= 5; d++) {
    it(`GB.hi >= GB.lo at differential ${d >= 0 ? `+${d}` : d}`, () => {
      const bands = assembleBackHalf(
        { powerVel: d, contactMov: d },
        FIXED_BB_HI_PLUS_ONE,
        frozenAccessors,
      )
      expect(bands.GB.hi).toBeGreaterThanOrEqual(bands.GB.lo)
    })
  }
})

// ─── Exact boundaries (frozen table, full [-5..+5] range) ─────────────────────

describe('exact boundaries (frozen table, full [-5..+5] range)', () => {
  for (let d = -5; d <= 5; d++) {
    it(`differential ${d >= 0 ? `+${d}` : d}: bands match frozen table exactly`, () => {
      const expected = expectedFrozenBands(d, d)
      expect(
        assembleBackHalf({ powerVel: d, contactMov: d }, FIXED_BB_HI_PLUS_ONE, frozenAccessors),
      ).toEqual(expected)
    })
  }
})

// ─── Error: GB negative ───────────────────────────────────────────────────────

describe('error: GB negative', () => {
  it('throws RangeError when FO + PO + K widths exceed available back-half space', () => {
    const overflowAccessors = {
      getFo: (_d: number) => 200,
      getPo: (_d: number) => 200,
      getK: (_d: number) => 200,
    } satisfies BackHalfAccessors
    expect(() => assembleBackHalf({ powerVel: 0, contactMov: 0 }, 200, overflowAccessors)).toThrow(
      RangeError,
    )
  })
})

// ─── Smoke test — live seed tables ───────────────────────────────────────────

describe('smoke test (live seed tables, full differential grid)', () => {
  // Derive realistic bbHiPlusOne from the actual front half so the GB ≥ 0
  // guarantee is tested under real system conditions (11^4 = 14641 combinations).
  it('GB >= 0 across the full [-5..+5]^4 differential grid', () => {
    for (let powerVel = -5; powerVel <= 5; powerVel++) {
      for (let speedAwa = -5; speedAwa <= 5; speedAwa++) {
        for (let eyeCmd = -5; eyeCmd <= 5; eyeCmd++) {
          for (let contactMov = -5; contactMov <= 5; contactMov++) {
            const frontBands = assembleFrontHalf({ powerVel, speedAwa, eyeCmd, contactMov })
            const bbHiPlusOne = frontBands.BB.hi + 1
            const bands = assembleBackHalf({ powerVel, contactMov }, bbHiPlusOne)
            expect(bands.GB.hi).toBeGreaterThanOrEqual(bands.GB.lo)
          }
        }
      }
    }
  })

  it('K.hi = 499 at every differential combination (live tables)', () => {
    for (let powerVel = -5; powerVel <= 5; powerVel++) {
      for (let contactMov = -5; contactMov <= 5; contactMov++) {
        const bands = assembleBackHalf({ powerVel, contactMov }, 170)
        expect(bands.K.hi).toBe(499)
      }
    }
  })

  it('partition covers exactly bbHiPlusOne through 499 at every differential combination (live tables)', () => {
    for (let powerVel = -5; powerVel <= 5; powerVel++) {
      for (let contactMov = -5; contactMov <= 5; contactMov++) {
        const bbHiPlusOne = 170
        const bands = assembleBackHalf({ powerVel, contactMov }, bbHiPlusOne)
        const entries = Object.values(bands)
        expect(entries[0].lo).toBe(bbHiPlusOne)
        for (let i = 1; i < entries.length; i++) {
          expect(entries[i].lo).toBe(entries[i - 1].hi + 1)
        }
        expect(entries[entries.length - 1].hi).toBe(499)
      }
    }
  })
})

// ─── Parity lane (local only — skips in CI) ───────────────────────────────────

// Literal path relative to project root (where Vitest always runs).
const PARITY_FIXTURE = 'packages/engine/reference/back-half-parity.json'
const FIXTURE_EXISTS = existsSync(PARITY_FIXTURE)

describe.skipIf(!FIXTURE_EXISTS)('parity lane (local fixture)', () => {
  // Guard: skipIf still runs the describe body for collection; bail before any file I/O.
  if (!FIXTURE_EXISTS) return

  interface ParityEntry {
    diffs: { powerVel: number; contactMov: number }
    bbHiPlusOne: number
    bands: BackHalfBands
  }
  interface ParityFixture {
    entries: ParityEntry[]
  }

  const fixture: ParityFixture = JSON.parse(readFileSync(PARITY_FIXTURE, 'utf-8'))

  // AC requires full [-5..+5] range (11 diffs) for both powerVel and contactMov
  expect(fixture.entries.length).toBeGreaterThanOrEqual(11)

  for (const entry of fixture.entries) {
    it(`parity match: diffs ${JSON.stringify(entry.diffs)}, bbHiPlusOne=${entry.bbHiPlusOne}`, () => {
      expect(assembleBackHalf(entry.diffs, entry.bbHiPlusOne)).toEqual(entry.bands)
    })
  }
})
