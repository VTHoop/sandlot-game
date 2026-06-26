import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { Band } from '../../../rangeFinder/frontHalf'
import type { BaseState } from '../../advance'
import { type DeepFlyAccessors, liveDeepFlyAccessors, resolveFlyOut } from '../deepFly'

// ─── Frozen test rig ──────────────────────────────────────────────────────────
// A 20-wide FO band with a fixed 50% deep-fly share → deep range [100, 109].
// Never change these; they pin exact boundaries independent of seed tuning.

const FO_BAND: Band = { lo: 100, hi: 119 }
const HALF_DEEP: DeepFlyAccessors = { deepFlyFraction: () => 0.5 }
const DEEP = 100 // low (batter-favorable) end → a deep fly
const DEEP_EDGE = 109 // last number still inside the deep range
const SHALLOW = 110 // first number past the deep range → a plain fly out
const POWER = 3

const EMPTY: BaseState = { first: null, second: null, third: null }
const THIRD_ONLY: BaseState = { first: null, second: null, third: 'r-third' }
const SECOND_ONLY: BaseState = { first: null, second: 'r-second', third: null }
const SECOND_AND_THIRD: BaseState = { first: null, second: 'r-second', third: 'r-third' }
const FIRST_ONLY: BaseState = { first: 'r-first', second: null, third: null }

const resolve = (difference: number, bases: BaseState, outsBefore: number) =>
  resolveFlyOut({ difference, band: FO_BAND, bases, outsBefore, power: POWER }, HALF_DEEP)

// ─── The batter is always out ─────────────────────────────────────────────────

describe('resolveFlyOut — the fly out always records the batter out', () => {
  it('adds exactly one out in every branch', () => {
    expect(resolve(DEEP, SECOND_AND_THIRD, 0).outsAfter).toBe(1)
    expect(resolve(SHALLOW, SECOND_AND_THIRD, 1).outsAfter).toBe(2)
    expect(resolve(DEEP, SECOND_AND_THIRD, 2).outsAfter).toBe(3)
  })
})

// ─── Deep fly with < 2 outs: tag-ups ──────────────────────────────────────────

describe('resolveFlyOut — deep fly (< 2 outs) advances tagging runners', () => {
  it('scores the runner from third (sac fly, RBI credited)', () => {
    expect(resolve(DEEP, THIRD_ONLY, 0)).toEqual({
      runsScored: 1,
      rbi: 1,
      basesAfter: { first: null, second: null, third: null },
      outsAfter: 1,
    })
  })

  it('tags the runner from second up to third (no run)', () => {
    expect(resolve(DEEP, SECOND_ONLY, 1)).toEqual({
      runsScored: 0,
      rbi: 0,
      basesAfter: { first: null, second: null, third: 'r-second' },
      outsAfter: 2,
    })
  })

  it('scores from third and tags second→third together', () => {
    expect(resolve(DEEP_EDGE, SECOND_AND_THIRD, 0)).toEqual({
      runsScored: 1,
      rbi: 1,
      basesAfter: { first: null, second: null, third: 'r-second' },
      outsAfter: 1,
    })
  })

  it('leaves a runner on first in place (a fly is not deep enough to advance from first)', () => {
    expect(resolve(DEEP, FIRST_ONLY, 0)).toEqual({
      runsScored: 0,
      rbi: 0,
      basesAfter: { first: 'r-first', second: null, third: null },
      outsAfter: 1,
    })
  })
})

// ─── Shallow fly: a plain out ─────────────────────────────────────────────────

describe('resolveFlyOut — a shallow fly is a plain out, no movement', () => {
  it('holds every runner just past the deep-range edge', () => {
    expect(resolve(SHALLOW, SECOND_AND_THIRD, 0)).toEqual({
      runsScored: 0,
      rbi: 0,
      basesAfter: SECOND_AND_THIRD,
      outsAfter: 1,
    })
  })

  it('does not advance on an empty-base deep fly', () => {
    expect(resolve(DEEP, EMPTY, 0).basesAfter).toEqual(EMPTY)
  })
})

// ─── 2 outs: the fly out ends the inning, no tag-ups ──────────────────────────

describe('resolveFlyOut — with 2 outs the fly out ends the inning', () => {
  it('scores no run and advances no runner even on a deep fly', () => {
    expect(resolve(DEEP, SECOND_AND_THIRD, 2)).toEqual({
      runsScored: 0,
      rbi: 0,
      basesAfter: SECOND_AND_THIRD,
      outsAfter: 3,
    })
  })
})

// ─── Power scales the deep-fly share (live seed tables) ───────────────────────

describe('resolveFlyOut — deep-fly share widens with power (live tables)', () => {
  // A mid-band difference that only a high-power hitter reaches into the deep range.
  const WIDE_BAND: Band = { lo: 0, hi: 99 }
  const MID = 35

  it('a high-power hitter tags up where a low-power hitter does not', () => {
    const lowPower = resolveFlyOut({
      difference: MID,
      band: WIDE_BAND,
      bases: THIRD_ONLY,
      outsBefore: 0,
      power: 1,
    })
    const highPower = resolveFlyOut({
      difference: MID,
      band: WIDE_BAND,
      bases: THIRD_ONLY,
      outsBefore: 0,
      power: 5,
    })
    expect(lowPower.runsScored).toBe(0) // shallow for a weak hitter
    expect(highPower.runsScored).toBe(1) // deep for a strong hitter
  })
})

// ─── Parity lane (local only — skips in CI) ───────────────────────────────────
// Validates the re-derived deep-fly widths against the gitignored ExtraBase-tab
// fixture (ADR-0006). The reference band width is the reconciliation knob (cf.
// the back-half REPRESENTATIVE_BB_HI_PLUS_ONE); widen/scale it to the workbook's
// own band when filling captureParity.py's `deep_fly` row range.

const PARITY_FIXTURE = 'packages/engine/reference/extra-base-parity.json'

describe.skipIf(!existsSync(PARITY_FIXTURE))('parity lane (local fixture)', () => {
  if (!existsSync(PARITY_FIXTURE)) return
  const fixture: { deep_fly: number[] | null } = JSON.parse(readFileSync(PARITY_FIXTURE, 'utf-8'))
  const REFERENCE_BAND_WIDTH = 100

  it.skipIf(fixture.deep_fly === null)('deep-fly width by power matches the workbook', () => {
    for (let power = 1; power <= 5; power++) {
      const width = Math.round(liveDeepFlyAccessors.deepFlyFraction(power) * REFERENCE_BAND_WIDTH)
      expect(width).toBe(fixture.deep_fly?.[power - 1])
    }
  })
})
