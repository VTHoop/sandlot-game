import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { Band } from '../../../rangeFinder/frontHalf'
import type { BaseState } from '../../advance'
import type { BaseSpeeds } from '../../resolve'
import { type ExtraBaseAccessors, liveExtraBaseAccessors, resolveExtraBase } from '../extraBase'

// ─── Frozen test rig ──────────────────────────────────────────────────────────
// A 20-wide hit band. The frozen accessor grants the extra base to a fast (5)
// runner over the low half of the band [50,59] and never to a slow (1) runner.
// Power is held neutral. Never change these — they pin exact boundaries.

const BAND: Band = { lo: 50, hi: 69 }
const FAST_HALF: ExtraBaseAccessors = {
  extraBaseFraction: (speed) => (speed >= 5 ? 0.5 : 0),
}
const LOW = 50 // batter-favorable end → extra base for a fast runner
const LOW_EDGE = 59 // last number still inside the fast runner's extra range
const HIGH = 60 // first number past the extra range → no extra base
const POWER = 3
const BATTER = 'batter'

const speeds = (first: number | null, second: number | null, third: number | null): BaseSpeeds => ({
  first,
  second,
  third,
})

const single = (difference: number, bases: BaseState, s: BaseSpeeds) =>
  resolveExtraBase(
    {
      outcome: '1B',
      difference,
      band: BAND,
      bases,
      outsBefore: 0,
      batter: BATTER,
      speeds: s,
      power: POWER,
    },
    FAST_HALF,
  )

const double = (difference: number, bases: BaseState, s: BaseSpeeds) =>
  resolveExtraBase(
    {
      outcome: '2B',
      difference,
      band: BAND,
      bases,
      outsBefore: 0,
      batter: BATTER,
      speeds: s,
      power: POWER,
    },
    FAST_HALF,
  )

// ─── Single: the standard one-base push is the base case ──────────────────────

describe('resolveExtraBase — single base case (no extra base)', () => {
  it('a slow runner takes only one base (matches the standard single)', () => {
    expect(single(LOW, { first: 'r1', second: null, third: null }, speeds(1, null, null))).toEqual({
      runsScored: 0,
      rbi: 0,
      basesAfter: { first: BATTER, second: 'r1', third: null },
      outsAfter: 0,
    })
  })

  it('scores the runner from third and pushes everyone one base when nobody is fast', () => {
    expect(single(LOW, { first: 'r1', second: 'r2', third: 'r3' }, speeds(1, 1, 1))).toEqual({
      runsScored: 1,
      rbi: 1,
      basesAfter: { first: BATTER, second: 'r1', third: 'r2' },
      outsAfter: 0,
    })
  })

  it('does not grant an extra base outside the batter-favorable range', () => {
    expect(
      single(HIGH, { first: 'r1', second: null, third: null }, speeds(5, null, null)).basesAfter,
    ).toEqual({ first: BATTER, second: 'r1', third: null })
  })
})

// ─── Single: the extra base ───────────────────────────────────────────────────

describe('resolveExtraBase — single with the extra base', () => {
  it('sends a fast runner from first to third', () => {
    expect(
      single(LOW_EDGE, { first: 'r1', second: null, third: null }, speeds(5, null, null))
        .basesAfter,
    ).toEqual({ first: BATTER, second: null, third: 'r1' })
  })

  it('scores a fast runner from second', () => {
    expect(single(LOW, { first: null, second: 'r2', third: null }, speeds(null, 5, null))).toEqual({
      runsScored: 1,
      rbi: 1,
      basesAfter: { first: BATTER, second: null, third: null },
      outsAfter: 0,
    })
  })

  it('lets a fast runner from first reach third only once second has vacated it', () => {
    // both fast: r2 scores from second, vacating third → r1 reaches third
    expect(single(LOW, { first: 'r1', second: 'r2', third: null }, speeds(5, 5, null))).toEqual({
      runsScored: 1,
      rbi: 1,
      basesAfter: { first: BATTER, second: null, third: 'r1' },
      outsAfter: 0,
    })
  })

  it('caps the trailing runner: a fast runner from first cannot pass a held runner on third', () => {
    // r2 slow holds at third; r1 fast cannot pass → capped at second
    expect(single(LOW, { first: 'r1', second: 'r2', third: null }, speeds(5, 1, null))).toEqual({
      runsScored: 0,
      rbi: 0,
      basesAfter: { first: BATTER, second: 'r1', third: 'r2' },
      outsAfter: 0,
    })
  })
})

// ─── Double: base case + extra base ───────────────────────────────────────────

describe('resolveExtraBase — double', () => {
  it('base case: scores 2nd/3rd, sends a slow runner from first to third, batter to second', () => {
    expect(double(LOW, { first: 'r1', second: 'r2', third: 'r3' }, speeds(1, 1, 1))).toEqual({
      runsScored: 2,
      rbi: 2,
      basesAfter: { first: null, second: BATTER, third: 'r1' },
      outsAfter: 0,
    })
  })

  it('scores a fast runner all the way from first', () => {
    expect(double(LOW, { first: 'r1', second: null, third: null }, speeds(5, null, null))).toEqual({
      runsScored: 1,
      rbi: 1,
      basesAfter: { first: null, second: BATTER, third: null },
      outsAfter: 0,
    })
  })

  it('holds a slow runner from first at third', () => {
    expect(
      double(LOW, { first: 'r1', second: null, third: null }, speeds(1, null, null)).basesAfter,
    ).toEqual({ first: null, second: BATTER, third: 'r1' })
  })
})

// ─── No out is recorded; outs pass through ────────────────────────────────────

describe('resolveExtraBase — a hit records no out', () => {
  it('passes the pre-state out count straight through', () => {
    const r = resolveExtraBase(
      {
        outcome: '1B',
        difference: LOW,
        band: BAND,
        bases: { first: 'r1', second: null, third: null },
        outsBefore: 2,
        batter: BATTER,
        speeds: speeds(1, null, null),
        power: POWER,
      },
      FAST_HALF,
    )
    expect(r.outsAfter).toBe(2)
  })
})

// ─── Speed scales the extra-base share (live seed tables) ─────────────────────

describe('resolveExtraBase — extra-base share widens with speed (live tables)', () => {
  const WIDE: Band = { lo: 0, hi: 99 }
  const MID = 30

  it('a fast runner takes the extra base where a slow runner does not', () => {
    const slow = resolveExtraBase({
      outcome: '1B',
      difference: MID,
      band: WIDE,
      bases: { first: null, second: 'r2', third: null },
      outsBefore: 0,
      batter: BATTER,
      speeds: speeds(null, 1, null),
      power: POWER,
    })
    const fast = resolveExtraBase({
      outcome: '1B',
      difference: MID,
      band: WIDE,
      bases: { first: null, second: 'r2', third: null },
      outsBefore: 0,
      batter: BATTER,
      speeds: speeds(null, 5, null),
      power: POWER,
    })
    expect(slow.runsScored).toBe(0) // r2 only reaches third
    expect(fast.runsScored).toBe(1) // r2 scores from second
  })
})

// ─── Parity lane (local only — skips in CI) ───────────────────────────────────
// Validates the re-derived extra-base widths against the gitignored ExtraBase-tab
// fixture (ADR-0006). Power is held neutral (3); the reference band width is the
// reconciliation knob — scale it to the workbook's own band when filling
// captureParity.py's `extra_base_high_end` / `extra_base_low_end` row ranges.

const PARITY_FIXTURE = 'packages/engine/reference/extra-base-parity.json'

describe.skipIf(!existsSync(PARITY_FIXTURE))('parity lane (local fixture)', () => {
  if (!existsSync(PARITY_FIXTURE)) return
  const fixture: { extra_base_high_end: number[] | null } = JSON.parse(
    readFileSync(PARITY_FIXTURE, 'utf-8'),
  )
  const REFERENCE_BAND_WIDTH = 100
  const NEUTRAL_POWER = 3

  it.skipIf(fixture.extra_base_high_end === null)(
    'high-end extra-base width by speed matches the workbook',
    () => {
      for (let speed = 1; speed <= 5; speed++) {
        const width = Math.round(
          liveExtraBaseAccessors.extraBaseFraction(speed, NEUTRAL_POWER) * REFERENCE_BAND_WIDTH,
        )
        expect(width).toBe(fixture.extra_base_high_end?.[speed - 1])
      }
    },
  )
})
