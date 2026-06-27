import { describe, expect, it } from 'vitest'
import { toAttributeDiff } from '../../../tables/accessor'
import type { BaseState } from '../../advance'
import { type BuntAccessors, selectBuntResult } from '../partition'
import { BuntResult } from '../result'

// Frozen widths make the [4, 496] middle band exact: bunt-for-hit [4, 13] (width
// 10), sacrifice [14, 113] (width 100), dud [114, 496]. The fixed tails are
// butcher boy [0, 3] and the triple/double-play top tail [497, 499].

const WIDTHS: BuntAccessors = { buntHitWidth: () => 10, sacWidth: () => 100 }
const DIFF0 = toAttributeDiff(0)
const FIRST: BaseState = { first: 'r1', second: null, third: null }
const FIRST_SECOND: BaseState = { first: 'r1', second: 'r2', third: null }
const EMPTY: BaseState = { first: null, second: null, third: null }

const select = (difference: number, bases: BaseState, outs = 0, accessors = WIDTHS) =>
  selectBuntResult(
    { difference, bases, outs, contactMovDiff: DIFF0, speedAwaDiff: DIFF0 },
    accessors,
  )

describe('selectBuntResult — fixed tails', () => {
  it('butcher boy covers the whole [0, 3] bottom tail', () => {
    expect(select(0, FIRST)).toBe(BuntResult.BUTCHER_BOY)
    expect(select(3, FIRST)).toBe(BuntResult.BUTCHER_BOY)
  })

  it('the top tail starts at 497 (496 is still the middle)', () => {
    expect(select(496, FIRST)).not.toBe(BuntResult.DP)
    expect(select(497, FIRST)).toBe(BuntResult.DP) // force on first, < 2 outs
    expect(select(499, FIRST)).toBe(BuntResult.DP)
  })
})

describe('selectBuntResult — elastic middle [4, 496]', () => {
  it('bunt-for-hit covers [4, 13]', () => {
    expect(select(4, FIRST)).toBe(BuntResult.BUNT_HIT)
    expect(select(13, FIRST)).toBe(BuntResult.BUNT_HIT)
  })

  it('the applicable sacrifice covers [14, 113]', () => {
    expect(select(14, FIRST)).toBe(BuntResult.SAC_2ND)
    expect(select(113, FIRST)).toBe(BuntResult.SAC_2ND)
    // a different lead runner selects a different sac label over the same range
    expect(select(50, FIRST_SECOND)).toBe(BuntResult.SAC_3RD)
  })

  it('the dud absorbs the remainder [114, 496]', () => {
    expect(select(114, FIRST)).toBe(BuntResult.DUD)
    expect(select(496, FIRST)).toBe(BuntResult.DUD)
  })

  it('with no runner aboard the sac range collapses into a dud', () => {
    expect(select(50, EMPTY)).toBe(BuntResult.DUD)
  })
})

describe('selectBuntResult — width clamping into the middle band', () => {
  const HUGE: BuntAccessors = { buntHitWidth: () => 10_000, sacWidth: () => 10_000 }

  it('a bunt-for-hit width past the band fills the whole middle (sac/dud collapse)', () => {
    expect(select(4, FIRST, 0, HUGE)).toBe(BuntResult.BUNT_HIT)
    expect(select(496, FIRST, 0, HUGE)).toBe(BuntResult.BUNT_HIT)
  })
})
