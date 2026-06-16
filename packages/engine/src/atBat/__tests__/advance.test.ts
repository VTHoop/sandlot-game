import { describe, expect, it } from 'vitest'
import { OUTCOME_BAND_KEYS } from '../../outcomes'
import { applyOutcome, type BaseState } from '../advance'

const EMPTY: BaseState = { first: false, second: false, third: false }
const LOADED: BaseState = { first: true, second: true, third: true }
const FIRST_ONLY: BaseState = { first: true, second: false, third: false }

describe('applyOutcome — standard one-base advancement (ADR-0016)', () => {
  it('HR clears the bases and scores everyone aboard plus the batter', () => {
    expect(applyOutcome('HR', EMPTY, 0)).toEqual({
      runsScored: 1,
      rbi: 1,
      basesAfter: EMPTY,
      outsAfter: 0,
    })
    expect(applyOutcome('HR', LOADED, 1)).toEqual({
      runsScored: 4,
      rbi: 4,
      basesAfter: EMPTY,
      outsAfter: 1,
    })
  })

  it('3B scores all runners and leaves the batter on third', () => {
    expect(applyOutcome('3B', LOADED, 0)).toEqual({
      runsScored: 3,
      rbi: 3,
      basesAfter: { first: false, second: false, third: true },
      outsAfter: 0,
    })
    expect(applyOutcome('3B', EMPTY, 0).basesAfter).toEqual({
      first: false,
      second: false,
      third: true,
    })
  })

  it('2B scores runners from 2nd/3rd, sends 1st to 3rd, batter to 2nd', () => {
    expect(applyOutcome('2B', LOADED, 0)).toEqual({
      runsScored: 2,
      rbi: 2,
      basesAfter: { first: false, second: true, third: true },
      outsAfter: 0,
    })
    expect(applyOutcome('2B', FIRST_ONLY, 0)).toEqual({
      runsScored: 0,
      rbi: 0,
      basesAfter: { first: false, second: true, third: true },
      outsAfter: 0,
    })
  })

  it('1B and IF1B advance every runner one base and put the batter on first', () => {
    for (const single of ['1B', 'IF1B'] as const) {
      expect(applyOutcome(single, LOADED, 0)).toEqual({
        runsScored: 1,
        rbi: 1,
        basesAfter: LOADED,
        outsAfter: 0,
      })
      expect(applyOutcome(single, EMPTY, 0).basesAfter).toEqual({
        first: true,
        second: false,
        third: false,
      })
    }
  })

  it('BB pushes only forced runners; scores a run only with the bases loaded', () => {
    expect(applyOutcome('BB', EMPTY, 0).basesAfter).toEqual({
      first: true,
      second: false,
      third: false,
    })
    expect(applyOutcome('BB', FIRST_ONLY, 0).basesAfter).toEqual({
      first: true,
      second: true,
      third: false,
    })
    // runner on third is NOT forced when second is open
    expect(applyOutcome('BB', { first: true, second: false, third: true }, 0)).toEqual({
      runsScored: 0,
      rbi: 0,
      basesAfter: { first: true, second: true, third: true },
      outsAfter: 0,
    })
    expect(applyOutcome('BB', LOADED, 0)).toEqual({
      runsScored: 1,
      rbi: 1,
      basesAfter: LOADED,
      outsAfter: 0,
    })
  })

  it('FO/PO/GB/K record an out with no runner movement (sub-resolution deferred)', () => {
    for (const out of ['FO', 'PO', 'GB', 'K'] as const) {
      expect(applyOutcome(out, LOADED, 1)).toEqual({
        runsScored: 0,
        rbi: 0,
        basesAfter: LOADED,
        outsAfter: 2,
      })
    }
  })

  it('handles every canonical outcome band without throwing', () => {
    for (const key of OUTCOME_BAND_KEYS) {
      expect(() => applyOutcome(key, LOADED, 0)).not.toThrow()
    }
  })

  it('does not mutate the input base state', () => {
    const before: BaseState = { first: true, second: true, third: true }
    applyOutcome('HR', before, 0)
    expect(before).toEqual(LOADED)
  })
})
