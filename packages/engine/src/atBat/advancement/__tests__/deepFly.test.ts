import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { Band } from '../../../rangeFinder/frontHalf'
import type { BaseState } from '../../advance'
import type { BaseSpeeds } from '../../resolve'
import { type DeepFlyAccessors, liveDeepFlyAccessors, resolveFlyOut } from '../deepFly'

// ─── Frozen test rig (Rules §2.6 / §2.6.1) ────────────────────────────────────
// A runner on 3rd scores on ANY fly out (<2 outs); a DEEP fly additionally tags
// the runner on 2nd up to 3rd. The frozen accessor calls a fly "deep" over the
// low half of the band [100,109] when the runner on 2nd is fast (≥ 4).

const FO_BAND: Band = { lo: 100, hi: 119 }
const FAST_DEEP: DeepFlyAccessors = { deepFlyFraction: (speed) => (speed >= 4 ? 0.5 : 0) }
const DEEP = 100 // low (batter-favorable) end → a deep fly
const SHALLOW = 110 // first number past the deep range → a shallow fly
const POWER = 3

const speeds = (first: number | null, second: number | null, third: number | null): BaseSpeeds => ({
  first,
  second,
  third,
})

const fly = (difference: number, bases: BaseState, s: BaseSpeeds, outsBefore = 0) =>
  resolveFlyOut(
    { difference, band: FO_BAND, bases, outsBefore, power: POWER, speeds: s },
    FAST_DEEP,
  )

const THIRD_ONLY: BaseState = { first: null, second: null, third: 'r-third' }
const SECOND_ONLY: BaseState = { first: null, second: 'r-second', third: null }
const SECOND_AND_THIRD: BaseState = { first: null, second: 'r-second', third: 'r-third' }
const FIRST_ONLY: BaseState = { first: 'r-first', second: null, third: null }

// ─── The batter is always out ─────────────────────────────────────────────────

describe('resolveFlyOut — the fly out always records the batter out', () => {
  it('adds exactly one out in every branch', () => {
    expect(fly(DEEP, SECOND_AND_THIRD, speeds(null, 5, null), 0).outsAfter).toBe(1)
    expect(fly(SHALLOW, SECOND_AND_THIRD, speeds(null, 5, null), 1).outsAfter).toBe(2)
    expect(fly(DEEP, SECOND_AND_THIRD, speeds(null, 5, null), 2).outsAfter).toBe(3)
  })
})

// ─── A runner on 3rd scores on ANY fly out (<2 outs) — not gated on depth ──────

describe('resolveFlyOut — sac fly from third on any fly out (§2.6)', () => {
  it('scores the runner from third even on a shallow fly', () => {
    expect(fly(SHALLOW, THIRD_ONLY, speeds(null, null, 1), 0)).toEqual({
      runsScored: 1,
      rbi: 1,
      basesAfter: { first: null, second: null, third: null },
      outsAfter: 1,
    })
  })

  it('scores from third with one out already', () => {
    expect(fly(SHALLOW, THIRD_ONLY, speeds(null, null, 3), 1).runsScored).toBe(1)
  })
})

// ─── A deep fly additionally tags the runner on 2nd up to 3rd (§2.6.1) ─────────

describe('resolveFlyOut — deep fly tags the runner on 2nd up to 3rd', () => {
  it('moves a fast runner from second to third on a deep fly (no run)', () => {
    expect(fly(DEEP, SECOND_ONLY, speeds(null, 5, null), 0)).toEqual({
      runsScored: 0,
      rbi: 0,
      basesAfter: { first: null, second: null, third: 'r-second' },
      outsAfter: 1,
    })
  })

  it('holds the runner on second on a shallow fly', () => {
    expect(fly(SHALLOW, SECOND_ONLY, speeds(null, 5, null), 0).basesAfter).toEqual(SECOND_ONLY)
  })

  it('holds a slow runner on second even at the deep end', () => {
    expect(fly(DEEP, SECOND_ONLY, speeds(null, 1, null), 0).basesAfter).toEqual(SECOND_ONLY)
  })

  it('scores from third and tags second→third together on a deep fly', () => {
    expect(fly(DEEP, SECOND_AND_THIRD, speeds(null, 5, null), 0)).toEqual({
      runsScored: 1,
      rbi: 1,
      basesAfter: { first: null, second: null, third: 'r-second' },
      outsAfter: 1,
    })
  })
})

// ─── A runner on 1st never advances; empty bases never move ───────────────────

describe('resolveFlyOut — runner on first holds; empty bases hold', () => {
  it('leaves a runner on first in place', () => {
    expect(fly(DEEP, FIRST_ONLY, speeds(1, null, null), 0).basesAfter).toEqual(FIRST_ONLY)
  })
})

// ─── 2 outs: the fly out ends the inning, no scoring or tag-ups ────────────────

describe('resolveFlyOut — with 2 outs the fly out ends the inning', () => {
  it('scores no run and advances no runner', () => {
    expect(fly(DEEP, SECOND_AND_THIRD, speeds(null, 5, null), 2)).toEqual({
      runsScored: 0,
      rbi: 0,
      basesAfter: SECOND_AND_THIRD,
      outsAfter: 3,
    })
  })
})

// ─── Deep-fly share widens with runner speed + power (live seed tables) ───────

describe('resolveFlyOut — deep-fly share widens with speed + power (live tables)', () => {
  const WIDE: Band = { lo: 0, hi: 99 }
  const MID = 12

  it('a fast runner with a strong hitter tags up where a slow runner with a weak hitter does not', () => {
    const weak = resolveFlyOut({
      difference: MID,
      band: WIDE,
      bases: SECOND_ONLY,
      outsBefore: 0,
      power: 1,
      speeds: speeds(null, 1, null),
    })
    const strong = resolveFlyOut({
      difference: MID,
      band: WIDE,
      bases: SECOND_ONLY,
      outsBefore: 0,
      power: 5,
      speeds: speeds(null, 5, null),
    })
    expect(weak.basesAfter.third).toBeNull() // shallow — runner holds on second
    expect(strong.basesAfter.third).toBe('r-second') // deep — runner tags to third
  })
})

// ─── Parity lane (local only — skips in CI) ───────────────────────────────────
// Validates the re-derived deep-fly widths against the gitignored ExtraBase-tab
// fixture (ADR-0006). Speed is held neutral (3); the reference band width is the
// reconciliation knob — scale it to the workbook's own band when filling
// captureParity.py's `deep_fly` row range.

const PARITY_FIXTURE = 'packages/engine/reference/extra-base-parity.json'

describe.skipIf(!existsSync(PARITY_FIXTURE))('parity lane (local fixture)', () => {
  if (!existsSync(PARITY_FIXTURE)) return
  const fixture: { deep_fly: number[] | null } = JSON.parse(readFileSync(PARITY_FIXTURE, 'utf-8'))
  const REFERENCE_BAND_WIDTH = 100
  const NEUTRAL_SPEED = 3

  it.skipIf(fixture.deep_fly === null)('deep-fly width by power matches the workbook', () => {
    for (let power = 1; power <= 5; power++) {
      const width = Math.round(
        liveDeepFlyAccessors.deepFlyFraction(NEUTRAL_SPEED, power) * REFERENCE_BAND_WIDTH,
      )
      expect(width).toBe(fixture.deep_fly?.[power - 1])
    }
  })
})
