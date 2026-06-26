import { describe, expect, it } from 'vitest'
import type { Band } from '../../../rangeFinder/frontHalf'
import type { BaseState } from '../../advance'
import { resolveGroundBall } from '../resolve'
import { GroundBallResult } from '../result'

const BAND: Band = { lo: 300, hi: 424 } // a representative elastic GB band
const B = 'B'
const FIRST: BaseState = { first: 'r1', second: null, third: null }
const THIRD: BaseState = { first: null, second: null, third: 'r3' }
const FIRST_SECOND: BaseState = { first: 'r1', second: 'r2', third: null }

describe('resolveGroundBall — selection within the band', () => {
  it('the bottom of the band is the first eligible result, the top is the last', () => {
    // Runner on first, 0 outs → eligible [GO_RA, FC, DP] (DP is the top slice).
    const bottom = resolveGroundBall({
      difference: BAND.lo,
      gbBand: BAND,
      basesBefore: FIRST,
      outsBefore: 0,
      batter: B,
      speedDiff: 0,
    })
    const top = resolveGroundBall({
      difference: BAND.hi,
      gbBand: BAND,
      basesBefore: FIRST,
      outsBefore: 0,
      batter: B,
      speedDiff: 0,
    })
    expect(bottom.result).toBe(GroundBallResult.GO_RA)
    expect(top.result).toBe(GroundBallResult.DP)
    expect(top.outsAfter).toBe(2) // batter + lead forced runner
  })
})

describe('resolveGroundBall — third-out run suppression (rules §2.9–2.15)', () => {
  it('GO_RA scores the runner from 3rd with <2 outs', () => {
    const r = resolveGroundBall({
      difference: BAND.lo,
      gbBand: BAND,
      basesBefore: THIRD,
      outsBefore: 1,
      batter: B,
      speedDiff: 0,
    })
    expect(r.result).toBe(GroundBallResult.GO_RA)
    expect(r.runsScored).toBe(1)
    expect(r.rbi).toBe(1)
    expect(r.outsAfter).toBe(2)
  })

  it('GO_RA out at 1st as the inning-ending third out suppresses the run', () => {
    const r = resolveGroundBall({
      difference: BAND.lo,
      gbBand: BAND,
      basesBefore: THIRD,
      outsBefore: 2,
      batter: B,
      speedDiff: 0,
    })
    expect(r.result).toBe(GroundBallResult.GO_RA)
    expect(r.outsAfter).toBe(3)
    expect(r.runsScored).toBe(0) // suppressed: the batter is out before the run counts
    expect(r.rbi).toBe(0)
  })

  it('a DP that ends the inning records two outs and no runs', () => {
    const r = resolveGroundBall({
      difference: BAND.hi,
      gbBand: BAND,
      basesBefore: FIRST_SECOND,
      outsBefore: 1,
      batter: B,
      speedDiff: 0,
    })
    expect(r.result).toBe(GroundBallResult.DP)
    expect(r.outsAfter).toBe(3)
    expect(r.runsScored).toBe(0)
  })

  it('a TP at the top of the band records three outs, no runs, and clears the bases', () => {
    // 1st & 2nd, 0 outs, top of the band → TP (delta=3, unconditional base clear).
    const r = resolveGroundBall({
      difference: BAND.hi,
      gbBand: BAND,
      basesBefore: FIRST_SECOND,
      outsBefore: 0,
      batter: B,
      speedDiff: 0,
    })
    expect(r.result).toBe(GroundBallResult.TP)
    expect(r.outsAfter).toBe(3)
    expect(r.runsScored).toBe(0)
    expect(r.rbi).toBe(0)
    expect(r.basesAfter).toEqual({ first: null, second: null, third: null })
  })
})
