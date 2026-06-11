import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { type AttributeDiff, toAttributeDiff } from '../../tables/accessor'
import type { FrontHalfAccessors, FrontHalfBands } from '../frontHalf'
import { assembleFrontHalf } from '../frontHalf'

// ─── Frozen test tables ───────────────────────────────────────────────────────
// Stable, simple values injected into the assembler for exact-boundary tests.
// Never change these; SAN-15 retuning touches seedTables.ts, not these.
// Indexed by diff+5 (index 0 = diff -5, index 10 = diff +5).

const FZ_HR = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] as const
const FZ_TRIPLE = [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1] as const
const FZ_DOUBLE = [2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2] as const
const FZ_IF1B = [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1] as const
const FZ_BB = [3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3] as const
const FZ_HIT_TOTAL = [20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20] as const

function clampIdx(diff: number): number {
  return Math.max(-5, Math.min(5, diff)) + 5
}

const frozenAccessors = {
  getHr: (d) => FZ_HR[clampIdx(d)],
  getTriple: (d) => FZ_TRIPLE[clampIdx(d)],
  getDouble: (d) => FZ_DOUBLE[clampIdx(d)],
  getIf1b: (d) => FZ_IF1B[clampIdx(d)],
  getBb: (d) => FZ_BB[clampIdx(d)],
  getSingle: ({ contactMov, powerVel, speedAwa }) =>
    Math.max(
      0,
      FZ_HIT_TOTAL[clampIdx(contactMov)] -
        FZ_HR[clampIdx(powerVel)] -
        FZ_TRIPLE[clampIdx(speedAwa)] -
        FZ_DOUBLE[clampIdx(speedAwa)] -
        FZ_IF1B[clampIdx(speedAwa)],
    ),
} satisfies FrontHalfAccessors

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Compute expected frozen bands for a given set of diffs (all equal for simplicity). */
function expectedFrozenBands(
  powerVel: number,
  speedAwa: number,
  eyeCmd: number,
  contactMov: number,
): FrontHalfBands {
  const hrW = FZ_HR[clampIdx(powerVel)]
  const tripleW = FZ_TRIPLE[clampIdx(speedAwa)]
  const doubleW = FZ_DOUBLE[clampIdx(speedAwa)]
  const if1bW = FZ_IF1B[clampIdx(speedAwa)]
  const bbW = FZ_BB[clampIdx(eyeCmd)]
  const singleW = Math.max(
    0,
    FZ_HIT_TOTAL[clampIdx(contactMov)] -
      FZ_HR[clampIdx(powerVel)] -
      FZ_TRIPLE[clampIdx(speedAwa)] -
      FZ_DOUBLE[clampIdx(speedAwa)] -
      FZ_IF1B[clampIdx(speedAwa)],
  )

  let cursor = 0
  function nextBand(width: number) {
    const lo = cursor
    const hi = cursor + width - 1
    cursor = hi + 1
    return { lo, hi }
  }

  return {
    HR: nextBand(hrW),
    '3B': nextBand(tripleW),
    '2B': nextBand(doubleW),
    '1B': nextBand(singleW),
    IF1B: nextBand(if1bW),
    BB: nextBand(bbW),
  }
}

// ─── Band order ───────────────────────────────────────────────────────────────

describe('band order', () => {
  it('result has all six front-half band keys in the correct order', () => {
    const bands = assembleFrontHalf({ powerVel: 0, speedAwa: 0, eyeCmd: 0, contactMov: 0 })
    expect(Object.keys(bands)).toEqual(['HR', '3B', '2B', '1B', 'IF1B', 'BB'])
  })
})

// ─── Cumulative layout ────────────────────────────────────────────────────────

describe('cumulative layout', () => {
  it('HR band starts at 0', () => {
    const { HR } = assembleFrontHalf(
      { powerVel: 0, speedAwa: 0, eyeCmd: 0, contactMov: 0 },
      frozenAccessors,
    )
    expect(HR.lo).toBe(0)
  })

  it('each band lo = previous band hi + 1', () => {
    const bands = assembleFrontHalf(
      { powerVel: 0, speedAwa: 0, eyeCmd: 0, contactMov: 0 },
      frozenAccessors,
    )
    Object.values(bands).reduce((prev, curr) => {
      expect(curr.lo).toBe(prev.hi + 1)
      return curr
    })
  })

  it('each band hi = lo + width - 1 (non-empty, no zero-width bands)', () => {
    const bands = assembleFrontHalf(
      { powerVel: 0, speedAwa: 0, eyeCmd: 0, contactMov: 0 },
      frozenAccessors,
    )
    for (const band of Object.values(bands)) {
      expect(band.hi).toBeGreaterThanOrEqual(band.lo)
    }
  })

  it('throws RangeError when a band width is zero (e.g. getSingle residual exhausted)', () => {
    const zeroSingleAccessors = {
      ...frozenAccessors,
      getSingle: () => 0,
    } satisfies FrontHalfAccessors
    expect(() =>
      assembleFrontHalf(
        { powerVel: 0, speedAwa: 0, eyeCmd: 0, contactMov: 0 },
        zeroSingleAccessors,
      ),
    ).toThrow(RangeError)
  })
})

// ─── Exact boundaries against frozen table ────────────────────────────────────

describe('exact boundaries (frozen table, full [-5..+5] range)', () => {
  for (let d = -5; d <= 5; d++) {
    it(`differential ${d >= 0 ? `+${d}` : d}: bands match frozen table exactly`, () => {
      const diff = toAttributeDiff(d)
      const diffs = { powerVel: diff, speedAwa: diff, eyeCmd: diff, contactMov: diff }
      const expected = expectedFrozenBands(d, d, d, d)
      expect(assembleFrontHalf(diffs, frozenAccessors)).toEqual(expected)
    })
  }
})

// ─── Smoke test — live tables ─────────────────────────────────────────────────

describe('smoke test (live seed tables)', () => {
  it('produces a well-formed partition at every differential', () => {
    for (let d = -5; d <= 5; d++) {
      const diff = toAttributeDiff(d)
      const bands = assembleFrontHalf({
        powerVel: diff,
        speedAwa: diff,
        eyeCmd: diff,
        contactMov: diff,
      })
      const entries = Object.values(bands)
      // Starts at 0
      expect(entries[0].lo).toBe(0)
      // Contiguous and non-overlapping
      entries.reduce((prev, curr) => {
        expect(curr.lo).toBe(prev.hi + 1)
        return curr
      })
      // No zero-width bands
      for (const band of entries) {
        expect(band.hi).toBeGreaterThanOrEqual(band.lo)
      }
      // Monotonically increasing boundaries
      entries.reduce((prev, curr) => {
        expect(curr.lo).toBeGreaterThan(prev.lo)
        return curr
      })
      // Front half must fit within the 0–499 range so the back half has room
      expect(bands.BB.hi).toBeLessThanOrEqual(499)
    }
  })

  it('HR band widens as powerVel diff increases (live tables)', () => {
    const atMinus5 = assembleFrontHalf({ powerVel: -5, speedAwa: 0, eyeCmd: 0, contactMov: 0 })
    const atPlus5 = assembleFrontHalf({ powerVel: 5, speedAwa: 0, eyeCmd: 0, contactMov: 0 })
    const hrWidthMinus5 = atMinus5.HR.hi - atMinus5.HR.lo + 1
    const hrWidthPlus5 = atPlus5.HR.hi - atPlus5.HR.lo + 1
    expect(hrWidthPlus5).toBeGreaterThan(hrWidthMinus5)
  })

  it('BB band widens as eyeCmd diff increases (live tables)', () => {
    const atMinus5 = assembleFrontHalf({ powerVel: 0, speedAwa: 0, eyeCmd: -5, contactMov: 0 })
    const atPlus5 = assembleFrontHalf({ powerVel: 0, speedAwa: 0, eyeCmd: 5, contactMov: 0 })
    const bbWidthMinus5 = atMinus5.BB.hi - atMinus5.BB.lo + 1
    const bbWidthPlus5 = atPlus5.BB.hi - atPlus5.BB.lo + 1
    expect(bbWidthPlus5).toBeGreaterThan(bbWidthMinus5)
  })
})

// ─── Clamp behavior ───────────────────────────────────────────────────────────

describe('clamp behavior', () => {
  it('input +7 clamps to +5 (same bands as +5)', () => {
    const c = toAttributeDiff(7)
    expect(assembleFrontHalf({ powerVel: c, speedAwa: c, eyeCmd: c, contactMov: c })).toEqual(
      assembleFrontHalf({ powerVel: 5, speedAwa: 5, eyeCmd: 5, contactMov: 5 }),
    )
  })

  it('input -7 clamps to -5 (same bands as -5)', () => {
    const c = toAttributeDiff(-7)
    expect(assembleFrontHalf({ powerVel: c, speedAwa: c, eyeCmd: c, contactMov: c })).toEqual(
      assembleFrontHalf({ powerVel: -5, speedAwa: -5, eyeCmd: -5, contactMov: -5 }),
    )
  })

  it('each diff clamps independently', () => {
    expect(
      assembleFrontHalf({
        powerVel: toAttributeDiff(99),
        speedAwa: toAttributeDiff(-99),
        eyeCmd: toAttributeDiff(99),
        contactMov: toAttributeDiff(-99),
      }),
    ).toEqual(assembleFrontHalf({ powerVel: 5, speedAwa: -5, eyeCmd: 5, contactMov: -5 }))
  })
})

// ─── Parity lane (local only — skips in CI) ───────────────────────────────────

// Literal path relative to project root (where Vitest always runs).
const PARITY_FIXTURE = 'packages/engine/reference/front-half-parity.json'
const FIXTURE_EXISTS = existsSync(PARITY_FIXTURE)

describe.skipIf(!FIXTURE_EXISTS)('parity lane (local fixture)', () => {
  // Guard: skipIf still runs the describe body for collection; bail before any file I/O.
  if (!FIXTURE_EXISTS) return

  interface ParityEntry {
    diffs: {
      powerVel: AttributeDiff
      speedAwa: AttributeDiff
      eyeCmd: AttributeDiff
      contactMov: AttributeDiff
    }
    bands: FrontHalfBands
  }
  interface ParityFixture {
    entries: ParityEntry[]
  }

  const fixture: ParityFixture = JSON.parse(readFileSync(PARITY_FIXTURE, 'utf-8'))

  // AC requires full [-5..+5] range (11 diffs) + at least 1 golden e2e matchup
  expect(fixture.entries.length).toBeGreaterThanOrEqual(12)

  for (const entry of fixture.entries) {
    it(`parity match: diffs ${JSON.stringify(entry.diffs)}`, () => {
      expect(assembleFrontHalf(entry.diffs)).toEqual(entry.bands)
    })
  }
})
