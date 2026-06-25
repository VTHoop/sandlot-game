import { describe, expect, it } from 'vitest'
import type { BaseState } from '../../advance'
import { advanceGroundBall } from '../advance'
import { GroundBallResult } from '../result'

// Distinct runner ids per base so each assertion pins *which* runner moved where
// (identity-preserving advancement, SAN-44). Batter is a fourth distinct id.
const B = 'B'
const EMPTY: BaseState = { first: null, second: null, third: null }
const FIRST: BaseState = { first: 'r1', second: null, third: null }
const THIRD: BaseState = { first: null, second: null, third: 'r3' }
const FIRST_SECOND: BaseState = { first: 'r1', second: 'r2', third: null }
const FIRST_THIRD: BaseState = { first: 'r1', second: null, third: 'r3' }
const SECOND_THIRD: BaseState = { first: null, second: 'r2', third: 'r3' }
const LOADED: BaseState = { first: 'r1', second: 'r2', third: 'r3' }

const { GO, GO_RA, FC, FC_2ND, FC_3RD, FC_HOME, DP, TP } = GroundBallResult

describe('advanceGroundBall — runner movement per sub-result (rules §2.9–2.15)', () => {
  it('GO: batter out at 1st, bases stay empty', () => {
    expect(advanceGroundBall(GO, EMPTY, B)).toEqual({
      runsScored: 0,
      outsDelta: 1,
      basesAfter: EMPTY,
    })
  })

  it('GO_RA: out at 1st, every runner advances one base (run scores from 3rd)', () => {
    expect(advanceGroundBall(GO_RA, FIRST, B)).toEqual({
      runsScored: 0,
      outsDelta: 1,
      basesAfter: { first: null, second: 'r1', third: null },
    })
    expect(advanceGroundBall(GO_RA, THIRD, B)).toEqual({
      runsScored: 1,
      outsDelta: 1,
      basesAfter: EMPTY,
    })
    expect(advanceGroundBall(GO_RA, LOADED, B)).toEqual({
      runsScored: 1,
      outsDelta: 1,
      basesAfter: { first: null, second: 'r1', third: 'r2' },
    })
  })

  it('FC: runner from 1st out at 2nd, batter to 1st, lead runners hold', () => {
    expect(advanceGroundBall(FC, FIRST, B)).toEqual({
      runsScored: 0,
      outsDelta: 1,
      basesAfter: { first: B, second: null, third: null },
    })
    expect(advanceGroundBall(FC, FIRST_THIRD, B)).toEqual({
      runsScored: 0,
      outsDelta: 1,
      basesAfter: { first: B, second: null, third: 'r3' },
    })
  })

  it('FC_2ND: runner from 1st out at 2nd, the runner ahead advances or scores', () => {
    expect(advanceGroundBall(FC_2ND, FIRST_SECOND, B)).toEqual({
      runsScored: 0,
      outsDelta: 1,
      basesAfter: { first: B, second: null, third: 'r2' },
    })
    expect(advanceGroundBall(FC_2ND, FIRST_THIRD, B)).toEqual({
      runsScored: 1,
      outsDelta: 1,
      basesAfter: { first: B, second: null, third: null },
    })
    expect(advanceGroundBall(FC_2ND, LOADED, B)).toEqual({
      runsScored: 1,
      outsDelta: 1,
      basesAfter: { first: B, second: null, third: 'r2' },
    })
  })

  it('FC_3RD: runner from 2nd out at 3rd, runner from 1st and batter safe', () => {
    expect(advanceGroundBall(FC_3RD, FIRST_SECOND, B)).toEqual({
      runsScored: 0,
      outsDelta: 1,
      basesAfter: { first: B, second: 'r1', third: null },
    })
    expect(advanceGroundBall(FC_3RD, LOADED, B)).toEqual({
      runsScored: 1,
      outsDelta: 1,
      basesAfter: { first: B, second: 'r1', third: null },
    })
  })

  it('FC_HOME: runner from 3rd out at home, all others and the batter advance', () => {
    expect(advanceGroundBall(FC_HOME, FIRST_THIRD, B)).toEqual({
      runsScored: 0,
      outsDelta: 1,
      basesAfter: { first: B, second: 'r1', third: null },
    })
    expect(advanceGroundBall(FC_HOME, SECOND_THIRD, B)).toEqual({
      runsScored: 0,
      outsDelta: 1,
      basesAfter: { first: B, second: null, third: 'r2' },
    })
    expect(advanceGroundBall(FC_HOME, LOADED, B)).toEqual({
      runsScored: 0,
      outsDelta: 1,
      basesAfter: { first: B, second: 'r1', third: 'r2' },
    })
  })

  it('DP: batter and the lead forced runner out (+2), non-forced runners hold', () => {
    expect(advanceGroundBall(DP, FIRST, B)).toEqual({
      runsScored: 0,
      outsDelta: 2,
      basesAfter: EMPTY,
    })
    expect(advanceGroundBall(DP, FIRST_SECOND, B)).toEqual({
      runsScored: 0,
      outsDelta: 2,
      basesAfter: { first: null, second: 'r1', third: null },
    })
    expect(advanceGroundBall(DP, FIRST_THIRD, B)).toEqual({
      runsScored: 0,
      outsDelta: 2,
      basesAfter: { first: null, second: null, third: 'r3' },
    })
    expect(advanceGroundBall(DP, LOADED, B)).toEqual({
      runsScored: 0,
      outsDelta: 2,
      basesAfter: { first: null, second: 'r1', third: 'r2' },
    })
  })

  it('TP: three outs, no runs, bases cleared', () => {
    expect(advanceGroundBall(TP, FIRST_SECOND, B)).toEqual({
      runsScored: 0,
      outsDelta: 3,
      basesAfter: EMPTY,
    })
    expect(advanceGroundBall(TP, LOADED, B)).toEqual({
      runsScored: 0,
      outsDelta: 3,
      basesAfter: EMPTY,
    })
  })

  it('does not mutate the input base state', () => {
    const before: BaseState = { first: 'r1', second: 'r2', third: 'r3' }
    advanceGroundBall(FC_HOME, before, B)
    expect(before).toEqual(LOADED)
  })
})
