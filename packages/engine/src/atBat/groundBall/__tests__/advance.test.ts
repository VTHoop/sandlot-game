import { describe, expect, it } from 'vitest'
import type { BaseState } from '../../advance'
import { advanceGroundBall, type GroundBallAdvance } from '../advance'
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
  // [label, sub-result, basesBefore, expected movement]. One row per (sub-result,
  // base state); distinct runner ids pin *which* runner moved where.
  const cases: Array<[string, GroundBallResult, BaseState, GroundBallAdvance]> = [
    [
      'GO · bases empty, batter out at 1st',
      GO,
      EMPTY,
      { runsScored: 0, outsDelta: 1, basesAfter: EMPTY },
    ],
    [
      'GO_RA · runner from 1st up one',
      GO_RA,
      FIRST,
      { runsScored: 0, outsDelta: 1, basesAfter: { first: null, second: 'r1', third: null } },
    ],
    [
      'GO_RA · runner scores from 3rd',
      GO_RA,
      THIRD,
      { runsScored: 1, outsDelta: 1, basesAfter: EMPTY },
    ],
    [
      'GO_RA · loaded, everyone up one',
      GO_RA,
      LOADED,
      { runsScored: 1, outsDelta: 1, basesAfter: { first: null, second: 'r1', third: 'r2' } },
    ],
    [
      'FC · 1st only, runner out at 2nd',
      FC,
      FIRST,
      { runsScored: 0, outsDelta: 1, basesAfter: { first: B, second: null, third: null } },
    ],
    [
      'FC · 1st&3rd, lead runner holds',
      FC,
      FIRST_THIRD,
      { runsScored: 0, outsDelta: 1, basesAfter: { first: B, second: null, third: 'r3' } },
    ],
    [
      'FC_2ND · 1st&2nd, runner ahead to 3rd',
      FC_2ND,
      FIRST_SECOND,
      { runsScored: 0, outsDelta: 1, basesAfter: { first: B, second: null, third: 'r2' } },
    ],
    [
      'FC_2ND · 1st&3rd, runner ahead scores',
      FC_2ND,
      FIRST_THIRD,
      { runsScored: 1, outsDelta: 1, basesAfter: { first: B, second: null, third: null } },
    ],
    [
      'FC_2ND · loaded, runner from 3rd scores',
      FC_2ND,
      LOADED,
      { runsScored: 1, outsDelta: 1, basesAfter: { first: B, second: null, third: 'r2' } },
    ],
    [
      'FC_3RD · 1st&2nd, runner from 2nd out at 3rd',
      FC_3RD,
      FIRST_SECOND,
      { runsScored: 0, outsDelta: 1, basesAfter: { first: B, second: 'r1', third: null } },
    ],
    [
      'FC_3RD · loaded, runner from 3rd scores',
      FC_3RD,
      LOADED,
      { runsScored: 1, outsDelta: 1, basesAfter: { first: B, second: 'r1', third: null } },
    ],
    [
      'FC_HOME · 1st&3rd, runner from 3rd out at home',
      FC_HOME,
      FIRST_THIRD,
      { runsScored: 0, outsDelta: 1, basesAfter: { first: B, second: 'r1', third: null } },
    ],
    [
      'FC_HOME · 2nd&3rd, others advance',
      FC_HOME,
      SECOND_THIRD,
      { runsScored: 0, outsDelta: 1, basesAfter: { first: B, second: null, third: 'r2' } },
    ],
    [
      'FC_HOME · loaded, others advance',
      FC_HOME,
      LOADED,
      { runsScored: 0, outsDelta: 1, basesAfter: { first: B, second: 'r1', third: 'r2' } },
    ],
    ['DP · 1st only, bases cleared', DP, FIRST, { runsScored: 0, outsDelta: 2, basesAfter: EMPTY }],
    [
      'DP · 1st&2nd, lead forced out at 3rd',
      DP,
      FIRST_SECOND,
      { runsScored: 0, outsDelta: 2, basesAfter: { first: null, second: 'r1', third: null } },
    ],
    [
      'DP · 1st&3rd, non-forced runner holds',
      DP,
      FIRST_THIRD,
      { runsScored: 0, outsDelta: 2, basesAfter: { first: null, second: null, third: 'r3' } },
    ],
    [
      'DP · loaded, lead forced out at home',
      DP,
      LOADED,
      { runsScored: 0, outsDelta: 2, basesAfter: { first: null, second: 'r1', third: 'r2' } },
    ],
    [
      'TP · 1st&2nd, three outs',
      TP,
      FIRST_SECOND,
      { runsScored: 0, outsDelta: 3, basesAfter: EMPTY },
    ],
    ['TP · loaded, three outs', TP, LOADED, { runsScored: 0, outsDelta: 3, basesAfter: EMPTY }],
  ]

  it.each(cases)('%s', (_label, result, basesBefore, expected) => {
    expect(advanceGroundBall(result, basesBefore, B)).toEqual(expected)
  })

  it('does not mutate the input base state', () => {
    const before: BaseState = { first: 'r1', second: 'r2', third: 'r3' }
    advanceGroundBall(FC_HOME, before, B)
    expect(before).toEqual(LOADED)
  })
})
