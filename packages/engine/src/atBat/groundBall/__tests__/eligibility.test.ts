import { describe, expect, it } from 'vitest'
import type { BaseState } from '../../advance'
import { eligibleGroundBallResults } from '../eligibility'
import { GroundBallResult } from '../result'

const bases = (first: boolean, second: boolean, third: boolean): BaseState => ({
  first: first ? 'r1' : null,
  second: second ? 'r2' : null,
  third: third ? 'r3' : null,
})

const EMPTY = bases(false, false, false)
const FIRST = bases(true, false, false)
const SECOND = bases(false, true, false)
const THIRD = bases(false, false, true)
const FIRST_SECOND = bases(true, true, false)
const FIRST_THIRD = bases(true, false, true)
const SECOND_THIRD = bases(false, true, true)
const LOADED = bases(true, true, true)

const { GO, GO_RA, FC, FC_2ND, FC_3RD, FC_HOME, DP, TP } = GroundBallResult

describe('eligibleGroundBallResults — structural eligibility (0 outs)', () => {
  it('bases empty → GO only', () => {
    expect(eligibleGroundBallResults(EMPTY, 0)).toEqual([GO])
  })

  it('runner on 1st → GO_RA, FC, DP (force for the DP, no TP)', () => {
    expect(eligibleGroundBallResults(FIRST, 0)).toEqual([GO_RA, FC, DP])
  })

  it('runner on 2nd or 3rd only → GO_RA only (no force, no FC variant)', () => {
    expect(eligibleGroundBallResults(SECOND, 0)).toEqual([GO_RA])
    expect(eligibleGroundBallResults(THIRD, 0)).toEqual([GO_RA])
  })

  it('1st & 2nd → GO_RA, FC_2ND, FC_3RD, DP, TP (force at 2nd and 3rd)', () => {
    expect(eligibleGroundBallResults(FIRST_SECOND, 0)).toEqual([GO_RA, FC_2ND, FC_3RD, DP, TP])
  })

  it('1st & 3rd → GO_RA, FC, FC_2ND, FC_HOME, DP (no TP — only one force)', () => {
    expect(eligibleGroundBallResults(FIRST_THIRD, 0)).toEqual([GO_RA, FC, FC_2ND, FC_HOME, DP])
  })

  it('2nd & 3rd → GO_RA, FC_HOME (no force, lead runner can be cut at home)', () => {
    expect(eligibleGroundBallResults(SECOND_THIRD, 0)).toEqual([GO_RA, FC_HOME])
  })

  it('bases loaded → GO_RA, FC_2ND, FC_3RD, FC_HOME, DP, TP', () => {
    expect(eligibleGroundBallResults(LOADED, 0)).toEqual([GO_RA, FC_2ND, FC_3RD, FC_HOME, DP, TP])
  })
})

describe('eligibleGroundBallResults — out gating (TP-tail collapse)', () => {
  it('with 1 out, TP drops but DP remains (DP absorbs the top tail)', () => {
    expect(eligibleGroundBallResults(LOADED, 1)).toEqual([GO_RA, FC_2ND, FC_3RD, FC_HOME, DP])
    expect(eligibleGroundBallResults(FIRST_SECOND, 1)).toEqual([GO_RA, FC_2ND, FC_3RD, DP])
  })

  it('with 2 outs, both DP and TP drop (next-lower result becomes the top slice)', () => {
    expect(eligibleGroundBallResults(LOADED, 2)).toEqual([GO_RA, FC_2ND, FC_3RD, FC_HOME])
    expect(eligibleGroundBallResults(FIRST, 2)).toEqual([GO_RA, FC])
    expect(eligibleGroundBallResults(FIRST_THIRD, 2)).toEqual([GO_RA, FC, FC_2ND, FC_HOME])
  })

  it('GO and GO_RA are never gated by outs (always at least one eligible result)', () => {
    expect(eligibleGroundBallResults(EMPTY, 2)).toEqual([GO])
    expect(eligibleGroundBallResults(SECOND, 2)).toEqual([GO_RA])
  })
})
