import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { Band } from '../../../rangeFinder/frontHalf'
import type { BaseState } from '../../advance'
import type { BaseSpeeds } from '../../resolve'
import { type ExtraBaseAccessors, liveExtraBaseAccessors, resolveExtraBase } from '../extraBase'

// ─── Frozen test rig (Rules §2.6.15) ──────────────────────────────────────────
// A well-hit ball advances EVERY runner one extra base (= two-out advancement),
// off a single floating share of the AVERAGE on-base runner speed (no hitter
// power). The frozen accessor calls a ball "well hit" over the low half of the
// band [50,59] when the average speed is fast (≥ 4), never when slow.

const BAND: Band = { lo: 50, hi: 69 }
const FAST_AVG: ExtraBaseAccessors = { wellHitFraction: (avg) => (avg >= 4 ? 0.5 : 0) }
const LOW = 50 // batter-favorable end → well hit for a fast average
const LOW_EDGE = 59 // last number still inside the well-hit range
const HIGH = 60 // first number past the well-hit range → a normal hit
const BATTER = 'batter'

const speeds = (first: number | null, second: number | null, third: number | null): BaseSpeeds => ({
  first,
  second,
  third,
})

const hit = (
  outcome: '1B' | '2B',
  difference: number,
  bases: BaseState,
  s: BaseSpeeds,
  outsBefore = 0,
) =>
  resolveExtraBase(
    { outcome, difference, band: BAND, bases, outsBefore, batter: BATTER, speeds: s },
    FAST_AVG,
  )

// ─── Single ───────────────────────────────────────────────────────────────────

describe('resolveExtraBase — single', () => {
  it('normal (not well hit): 3rd scores, 2nd→3rd, 1st→2nd, batter to first', () => {
    expect(hit('1B', LOW, { first: 'r1', second: 'r2', third: 'r3' }, speeds(1, 1, 1))).toEqual({
      runsScored: 1,
      rbi: 1,
      basesAfter: { first: BATTER, second: 'r1', third: 'r2' },
      outsAfter: 0,
    })
  })

  it('well hit: every runner advances an extra base — 3rd & 2nd score, 1st→3rd', () => {
    expect(hit('1B', LOW, { first: 'r1', second: 'r2', third: 'r3' }, speeds(5, 5, 5))).toEqual({
      runsScored: 2,
      rbi: 2,
      basesAfter: { first: BATTER, second: null, third: 'r1' },
      outsAfter: 0,
    })
  })

  it('well hit only inside the batter-favorable range', () => {
    expect(
      hit('1B', LOW_EDGE, { first: 'r1', second: null, third: null }, speeds(5, null, null))
        .basesAfter,
    ).toEqual({ first: BATTER, second: null, third: 'r1' })
    expect(
      hit('1B', HIGH, { first: 'r1', second: null, third: null }, speeds(5, null, null)).basesAfter,
    ).toEqual({
      first: BATTER,
      second: 'r1',
      third: null,
    })
  })
})

// ─── Double ───────────────────────────────────────────────────────────────────

describe('resolveExtraBase — double', () => {
  it('normal: 3rd & 2nd score, 1st→3rd, batter to second', () => {
    expect(hit('2B', LOW, { first: 'r1', second: 'r2', third: 'r3' }, speeds(1, 1, 1))).toEqual({
      runsScored: 2,
      rbi: 2,
      basesAfter: { first: null, second: BATTER, third: 'r1' },
      outsAfter: 0,
    })
  })

  it('well hit: doubles score all runners, batter to second', () => {
    expect(hit('2B', LOW, { first: 'r1', second: 'r2', third: 'r3' }, speeds(5, 5, 5))).toEqual({
      runsScored: 3,
      rbi: 3,
      basesAfter: { first: null, second: BATTER, third: null },
      outsAfter: 0,
    })
  })
})

// ─── A single all-or-nothing determination on the AVERAGE speed ───────────────

describe('resolveExtraBase — keyed on the average of the on-base runners', () => {
  it('averages mixed runner speeds (a 5 and a 3 average to 4 → well hit)', () => {
    // runners on 1st (fast) and 2nd (medium); the average crosses the well-hit cut
    // and BOTH advance the extra base together (not per-runner).
    expect(hit('1B', LOW, { first: 'r1', second: 'r2', third: null }, speeds(5, 3, null))).toEqual({
      runsScored: 1, // r2 scores from second
      rbi: 1,
      basesAfter: { first: BATTER, second: null, third: 'r1' }, // r1 takes the extra base too
      outsAfter: 0,
    })
  })

  it('an empty-base hit just seats the batter (no runners to advance)', () => {
    expect(
      hit('1B', LOW, { first: null, second: null, third: null }, speeds(null, null, null)),
    ).toEqual({
      runsScored: 0,
      rbi: 0,
      basesAfter: { first: BATTER, second: null, third: null },
      outsAfter: 0,
    })
  })
})

// ─── Two outs forces the extra base; well-hit + 2 outs do not stack ───────────

describe('resolveExtraBase — two outs', () => {
  it('advances every runner the extra base even when not well hit', () => {
    expect(
      hit('1B', HIGH, { first: 'r1', second: null, third: null }, speeds(1, null, null), 2),
    ).toEqual({
      runsScored: 0,
      rbi: 0,
      basesAfter: { first: BATTER, second: null, third: 'r1' }, // 1st→3rd, just like a well hit
      outsAfter: 2,
    })
  })

  it('does not stack — a well-hit ball with 2 outs still advances exactly one extra base', () => {
    expect(
      hit('1B', LOW, { first: 'r1', second: null, third: null }, speeds(5, null, null), 2)
        .basesAfter,
    ).toEqual({ first: BATTER, second: null, third: 'r1' })
  })
})

// ─── Well-hit share widens with average speed (live seed tables) ──────────────

describe('resolveExtraBase — well-hit share widens with speed (live tables)', () => {
  const WIDE: Band = { lo: 0, hi: 99 }
  const MID = 30

  it('a fast average takes the extra base where a slow average does not', () => {
    const slow = resolveExtraBase({
      outcome: '1B',
      difference: MID,
      band: WIDE,
      bases: { first: null, second: 'r2', third: null },
      outsBefore: 0,
      batter: BATTER,
      speeds: speeds(null, 1, null),
    })
    const fast = resolveExtraBase({
      outcome: '1B',
      difference: MID,
      band: WIDE,
      bases: { first: null, second: 'r2', third: null },
      outsBefore: 0,
      batter: BATTER,
      speeds: speeds(null, 5, null),
    })
    expect(slow.runsScored).toBe(0) // r2 only reaches third
    expect(fast.runsScored).toBe(1) // r2 scores from second on the extra base
  })
})

// ─── Parity lane (local only — skips in CI) ───────────────────────────────────
// Validates the re-derived well-hit widths against the gitignored ExtraBase-tab
// fixture (ADR-0006). The reference band width is the reconciliation knob — scale
// it to the workbook's own band when filling captureParity.py's row ranges.

const PARITY_FIXTURE = 'packages/engine/reference/extra-base-parity.json'

describe.skipIf(!existsSync(PARITY_FIXTURE))('parity lane (local fixture)', () => {
  if (!existsSync(PARITY_FIXTURE)) return
  const fixture: { extra_base_high_end: number[] | null } = JSON.parse(
    readFileSync(PARITY_FIXTURE, 'utf-8'),
  )
  const REFERENCE_BAND_WIDTH = 100

  it.skipIf(fixture.extra_base_high_end === null)(
    'well-hit width by average speed matches the workbook',
    () => {
      for (let speed = 1; speed <= 5; speed++) {
        const width = Math.round(
          liveExtraBaseAccessors.wellHitFraction(speed) * REFERENCE_BAND_WIDTH,
        )
        expect(width).toBe(fixture.extra_base_high_end?.[speed - 1])
      }
    },
  )
})
