import { describe, expect, it } from 'vitest'
import type { BaseState } from '../../advance'
import { advanceBunt } from '../advance'
import { BuntResult } from '../result'

// advanceBunt is pure and out-count-agnostic (third-out suppression lives in
// resolveBunt), so these assert raw movement + run/out deltas per sub-result.

const BATTER = 'batter'
const EMPTY: BaseState = { first: null, second: null, third: null }
const FIRST: BaseState = { first: 'r1', second: null, third: null }
const THIRD: BaseState = { first: null, second: null, third: 'r3' }
const FIRST_SECOND: BaseState = { first: 'r1', second: 'r2', third: null }
const FIRST_THIRD: BaseState = { first: 'r1', second: null, third: 'r3' }
const LOADED: BaseState = { first: 'r1', second: 'r2', third: 'r3' }

describe('advanceBunt — butcher boy', () => {
  it('awards a single and advances every runner an extra base', () => {
    expect(advanceBunt(BuntResult.BUTCHER_BOY, LOADED, BATTER)).toEqual({
      runsScored: 2, // r3 and r2 score
      outsDelta: 0,
      basesAfter: { first: BATTER, second: null, third: 'r1' }, // r1 takes the extra base
    })
  })
})

describe('advanceBunt — bunt for a hit (batter safe, runners advance one base)', () => {
  it('scores a runner from third', () => {
    expect(advanceBunt(BuntResult.BUNT_HIT, THIRD, BATTER)).toEqual({
      runsScored: 1,
      outsDelta: 0,
      basesAfter: { first: BATTER, second: null, third: null },
    })
  })

  it('pushes a runner from first to second', () => {
    expect(advanceBunt(BuntResult.BUNT_HIT, FIRST, BATTER).basesAfter).toEqual({
      first: BATTER,
      second: 'r1',
      third: null,
    })
  })
})

describe('advanceBunt — sacrifice (every runner advances one base, batter out)', () => {
  it('SAC_3RD with runners on first & second advances both (1st→2nd, 2nd→3rd)', () => {
    expect(advanceBunt(BuntResult.SAC_3RD, FIRST_SECOND, BATTER)).toEqual({
      runsScored: 0,
      outsDelta: 1,
      basesAfter: { first: null, second: 'r1', third: 'r2' },
    })
  })

  it('SAC_HOME scores the runner from third and advances the rest', () => {
    expect(advanceBunt(BuntResult.SAC_HOME, LOADED, BATTER)).toEqual({
      runsScored: 1,
      outsDelta: 1,
      basesAfter: { first: null, second: 'r1', third: 'r2' },
    })
  })

  it('SAC_2ND with a lone runner on first', () => {
    expect(advanceBunt(BuntResult.SAC_2ND, FIRST, BATTER).basesAfter).toEqual({
      first: null,
      second: 'r1',
      third: null,
    })
  })
})

describe('advanceBunt — double play (lead forced runner + batter out)', () => {
  it('bases loaded: the lead runner is out at home, the rest shift up', () => {
    expect(advanceBunt(BuntResult.DP, LOADED, BATTER)).toEqual({
      runsScored: 0,
      outsDelta: 2,
      basesAfter: { first: null, second: 'r1', third: 'r2' },
    })
  })

  it('first & second: the lead is out at third, first→second', () => {
    expect(advanceBunt(BuntResult.DP, FIRST_SECOND, BATTER).basesAfter).toEqual({
      first: null,
      second: 'r1',
      third: null,
    })
  })

  it('first & third: the non-forced runner on third holds', () => {
    expect(advanceBunt(BuntResult.DP, FIRST_THIRD, BATTER).basesAfter).toEqual({
      first: null,
      second: null,
      third: 'r3',
    })
  })

  it('first only: both the batter and the runner are out', () => {
    expect(advanceBunt(BuntResult.DP, FIRST, BATTER).basesAfter).toEqual(EMPTY)
  })
})

describe('advanceBunt — triple play / dud', () => {
  it('a triple play clears the bases for three outs', () => {
    expect(advanceBunt(BuntResult.TP, FIRST_SECOND, BATTER)).toEqual({
      runsScored: 0,
      outsDelta: 3,
      basesAfter: EMPTY,
    })
  })

  it('a dud records the batter out with no runner movement', () => {
    expect(advanceBunt(BuntResult.DUD, FIRST_SECOND, BATTER)).toEqual({
      runsScored: 0,
      outsDelta: 1,
      basesAfter: FIRST_SECOND,
    })
  })
})

describe('advanceBunt — unknown result', () => {
  it('throws a RangeError', () => {
    expect(() => advanceBunt('NOPE' as BuntResult, EMPTY, BATTER)).toThrow(RangeError)
  })
})
