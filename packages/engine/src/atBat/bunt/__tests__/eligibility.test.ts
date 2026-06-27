import { describe, expect, it } from 'vitest'
import type { BaseState } from '../../advance'
import { buntEligibility } from '../eligibility'
import { BuntResult } from '../result'

const EMPTY: BaseState = { first: null, second: null, third: null }
const FIRST: BaseState = { first: 'r1', second: null, third: null }
const SECOND: BaseState = { first: null, second: 'r2', third: null }
const THIRD: BaseState = { first: null, second: null, third: 'r3' }
const FIRST_SECOND: BaseState = { first: 'r1', second: 'r2', third: null }
const FIRST_THIRD: BaseState = { first: 'r1', second: null, third: 'r3' }
const LOADED: BaseState = { first: 'r1', second: 'r2', third: 'r3' }

describe('buntEligibility — the sacrifice advances the lead runner', () => {
  it('a runner on third → Sac Home', () => {
    expect(buntEligibility(THIRD, 0).sac).toBe(BuntResult.SAC_HOME)
  })

  it('a runner on second (none on third) → Sac 3rd', () => {
    expect(buntEligibility(SECOND, 0).sac).toBe(BuntResult.SAC_3RD)
  })

  it('a runner on first (none ahead) → Sac 2nd', () => {
    expect(buntEligibility(FIRST, 0).sac).toBe(BuntResult.SAC_2ND)
  })

  it('first & second → Sac 3rd (lead runner is on second)', () => {
    expect(buntEligibility(FIRST_SECOND, 0).sac).toBe(BuntResult.SAC_3RD)
  })

  it('first & third → Sac Home (lead runner is on third)', () => {
    expect(buntEligibility(FIRST_THIRD, 0).sac).toBe(BuntResult.SAC_HOME)
  })

  it('loaded → Sac Home', () => {
    expect(buntEligibility(LOADED, 0).sac).toBe(BuntResult.SAC_HOME)
  })

  it('bases empty → no sacrifice', () => {
    expect(buntEligibility(EMPTY, 0).sac).toBeNull()
  })
})

describe('buntEligibility — the 498–500 top tail', () => {
  it('first & second with 0 outs → triple play', () => {
    expect(buntEligibility(FIRST_SECOND, 0).topTail).toBe(BuntResult.TP)
  })

  it('loaded with 0 outs → triple play', () => {
    expect(buntEligibility(LOADED, 0).topTail).toBe(BuntResult.TP)
  })

  it('first & second with an out already → double play (no triple)', () => {
    expect(buntEligibility(FIRST_SECOND, 1).topTail).toBe(BuntResult.DP)
  })

  it('a lone runner on first with < 2 outs → double play', () => {
    expect(buntEligibility(FIRST, 0).topTail).toBe(BuntResult.DP)
    expect(buntEligibility(FIRST, 1).topTail).toBe(BuntResult.DP)
  })

  it('first with 2 outs → dud (no force play left)', () => {
    expect(buntEligibility(FIRST, 2).topTail).toBe(BuntResult.DUD)
  })

  it('a runner on second only (no force on first) → dud', () => {
    expect(buntEligibility(SECOND, 0).topTail).toBe(BuntResult.DUD)
  })

  it('bases empty → dud', () => {
    expect(buntEligibility(EMPTY, 0).topTail).toBe(BuntResult.DUD)
  })
})
