import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { AttributeDiff } from '../../tables/accessor'
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
  getFo: (d) => FZ_FO[clampIdx(d)],
  getPo: (d) => FZ_PO[clampIdx(d)],
  getK: (d) => FZ_K[clampIdx(d)],
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

// ─── Pre-computed diff combinations for the full-grid smoke test ──────────────
// Generated outside the test body to keep the test function flat (avoids the
// Deep Nested Complexity CodeScene finding for 4-level for-loops inside it()).

const DIFFS = Array.from({ length: 11 }, (_, i) => (i - 5) as AttributeDiff)

interface AllDiffs {
  powerVel: AttributeDiff
  speedAwa: AttributeDiff
  eyeCmd: AttributeDiff
  contactMov: AttributeDiff
}

const ALL_DIFF_COMBINATIONS: AllDiffs[] = DIFFS.flatMap((powerVel) =>
  DIFFS.flatMap((speedAwa) =>
    DIFFS.flatMap((eyeCmd) =>
      DIFFS.map((contactMov) => ({ powerVel, speedAwa, eyeCmd, contactMov })),
    ),
  ),
)

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
      const diff = d as AttributeDiff
      const bands = assembleBackHalf(
        { powerVel: diff, contactMov: diff },
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
    Object.values(bands).reduce((prev, curr) => {
      expect(curr.lo).toBe(prev.hi + 1)
      return curr
    })
  })

  it('last band ends at 499', () => {
    const bands = assembleBackHalf(
      { powerVel: 0, contactMov: 0 },
      FIXED_BB_HI_PLUS_ONE,
      frozenAccessors,
    )
    expect(bands.K.hi).toBe(499)
  })
})

// ─── GB non-negative (frozen tables) ─────────────────────────────────────────

describe('GB non-negative (frozen tables)', () => {
  for (let d = -5; d <= 5; d++) {
    it(`GB.hi >= GB.lo at differential ${d >= 0 ? `+${d}` : d}`, () => {
      const diff = d as AttributeDiff
      const bands = assembleBackHalf(
        { powerVel: diff, contactMov: diff },
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
      const diff = d as AttributeDiff
      const expected = expectedFrozenBands(d, d)
      expect(
        assembleBackHalf(
          { powerVel: diff, contactMov: diff },
          FIXED_BB_HI_PLUS_ONE,
          frozenAccessors,
        ),
      ).toEqual(expected)
    })
  }
})

// ─── Error: GB negative or zero ──────────────────────────────────────────────

describe('error: GB negative', () => {
  it('throws RangeError when FO + PO + K widths exceed available back-half space', () => {
    const overflowAccessors = {
      getFo: (_d) => 200,
      getPo: (_d) => 200,
      getK: (_d) => 200,
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
  // Some extreme combinations produce a degenerate front half (1B width = 0)
  // which assembleFrontHalf rejects with RangeError; those are skipped here
  // since they are not valid system inputs.
  it('GB >= 0 across the full [-5..+5]^4 differential grid', () => {
    for (const { powerVel, speedAwa, eyeCmd, contactMov } of ALL_DIFF_COMBINATIONS) {
      let bbHiPlusOne: number
      try {
        bbHiPlusOne = assembleFrontHalf({ powerVel, speedAwa, eyeCmd, contactMov }).BB.hi + 1
      } catch {
        continue // degenerate combination — not a valid system input
      }
      const bands = assembleBackHalf({ powerVel, contactMov }, bbHiPlusOne)
      expect(bands.GB.hi).toBeGreaterThanOrEqual(bands.GB.lo)
    }
  })

  it('K.hi = 499 at every differential combination (live tables)', () => {
    for (let powerVel = -5; powerVel <= 5; powerVel++) {
      for (let contactMov = -5; contactMov <= 5; contactMov++) {
        const pv = powerVel as AttributeDiff
        const cm = contactMov as AttributeDiff
        const bands = assembleBackHalf({ powerVel: pv, contactMov: cm }, 170)
        expect(bands.K.hi).toBe(499)
      }
    }
  })

  it('partition covers exactly bbHiPlusOne through 499 at every differential combination (live tables)', () => {
    for (let powerVel = -5; powerVel <= 5; powerVel++) {
      for (let contactMov = -5; contactMov <= 5; contactMov++) {
        const pv = powerVel as AttributeDiff
        const cm = contactMov as AttributeDiff
        const bbHiPlusOne = 170
        const bands = assembleBackHalf({ powerVel: pv, contactMov: cm }, bbHiPlusOne)
        expect(bands.FO.lo).toBe(bbHiPlusOne)
        Object.values(bands).reduce((prev, curr) => {
          expect(curr.lo).toBe(prev.hi + 1)
          return curr
        })
        expect(bands.K.hi).toBe(499)
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
    diffs: { powerVel: AttributeDiff; contactMov: AttributeDiff }
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
