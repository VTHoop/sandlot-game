import { describe, expect, it } from 'vitest'
import { OUTCOME_BAND_KEYS } from '../../outcomes'
import { applyOutcome, type BaseState } from '../advance'

// Runner-aware bases (SAN-44): each base holds the id of the runner standing on
// it, or null. Distinct ids per base let us assert *which* runner moved where,
// not merely that a base is occupied.
const EMPTY: BaseState = { first: null, second: null, third: null }
const LOADED: BaseState = { first: 'r-first', second: 'r-second', third: 'r-third' }
const FIRST_ONLY: BaseState = { first: 'r-first', second: null, third: null }
const BATTER = 'batter'

describe('applyOutcome — standard one-base advancement (ADR-0016)', () => {
  it('HR clears the bases and scores everyone aboard plus the batter', () => {
    expect(applyOutcome('HR', EMPTY, 0, BATTER)).toEqual({
      runsScored: 1,
      rbi: 1,
      basesAfter: EMPTY,
      outsAfter: 0,
    })
    expect(applyOutcome('HR', LOADED, 1, BATTER)).toEqual({
      runsScored: 4,
      rbi: 4,
      basesAfter: EMPTY,
      outsAfter: 1,
    })
  })

  it('3B scores all runners and leaves the batter on third', () => {
    expect(applyOutcome('3B', LOADED, 0, BATTER)).toEqual({
      runsScored: 3,
      rbi: 3,
      basesAfter: { first: null, second: null, third: BATTER },
      outsAfter: 0,
    })
    expect(applyOutcome('3B', EMPTY, 0, BATTER).basesAfter).toEqual({
      first: null,
      second: null,
      third: BATTER,
    })
  })

  it('2B scores runners from 2nd/3rd, sends 1st to 3rd, batter to 2nd', () => {
    expect(applyOutcome('2B', LOADED, 0, BATTER)).toEqual({
      runsScored: 2,
      rbi: 2,
      basesAfter: { first: null, second: BATTER, third: 'r-first' },
      outsAfter: 0,
    })
    expect(applyOutcome('2B', FIRST_ONLY, 0, BATTER)).toEqual({
      runsScored: 0,
      rbi: 0,
      basesAfter: { first: null, second: BATTER, third: 'r-first' },
      outsAfter: 0,
    })
  })

  it('1B and IF1B advance every runner one base and put the batter on first', () => {
    for (const single of ['1B', 'IF1B'] as const) {
      expect(applyOutcome(single, LOADED, 0, BATTER)).toEqual({
        runsScored: 1,
        rbi: 1,
        basesAfter: { first: BATTER, second: 'r-first', third: 'r-second' },
        outsAfter: 0,
      })
      expect(applyOutcome(single, EMPTY, 0, BATTER).basesAfter).toEqual({
        first: BATTER,
        second: null,
        third: null,
      })
    }
  })

  it('BB pushes only forced runners; scores a run only with the bases loaded', () => {
    expect(applyOutcome('BB', EMPTY, 0, BATTER).basesAfter).toEqual({
      first: BATTER,
      second: null,
      third: null,
    })
    expect(applyOutcome('BB', FIRST_ONLY, 0, BATTER).basesAfter).toEqual({
      first: BATTER,
      second: 'r-first',
      third: null,
    })
    // runner on third is NOT forced when second is open — it stays put, no run
    expect(
      applyOutcome('BB', { first: 'r-first', second: null, third: 'r-third' }, 0, BATTER),
    ).toEqual({
      runsScored: 0,
      rbi: 0,
      basesAfter: { first: BATTER, second: 'r-first', third: 'r-third' },
      outsAfter: 0,
    })
    expect(applyOutcome('BB', LOADED, 0, BATTER)).toEqual({
      runsScored: 1,
      rbi: 1,
      basesAfter: { first: BATTER, second: 'r-first', third: 'r-second' },
      outsAfter: 0,
    })
  })

  it('FO/PO/GB/K record an out with no runner movement (sub-resolution deferred)', () => {
    for (const out of ['FO', 'PO', 'GB', 'K'] as const) {
      expect(applyOutcome(out, LOADED, 1, BATTER)).toEqual({
        runsScored: 0,
        rbi: 0,
        basesAfter: LOADED,
        outsAfter: 2,
      })
    }
  })

  it('handles every canonical outcome band without throwing', () => {
    for (const key of OUTCOME_BAND_KEYS) {
      expect(() => applyOutcome(key, LOADED, 0, BATTER)).not.toThrow()
    }
  })

  it('does not mutate the input base state', () => {
    const before: BaseState = { first: 'r-first', second: 'r-second', third: 'r-third' }
    applyOutcome('HR', before, 0, BATTER)
    expect(before).toEqual(LOADED)
  })
})

/**
 * Behavior-preserving gate (SAN-44 keystone): the runner-aware model must produce
 * the *same occupancy* the prior boolean model did. Projecting each runner-aware
 * post-state back to `{first,second,third}: boolean` reproduces the occupancy the
 * old advancers yielded — so this enrichment changes who is on base, never the
 * run/out math that occupancy alone drove.
 */
describe('occupancy-projection equivalence with the prior boolean model', () => {
  const occupancyOf = (b: BaseState) => ({
    first: b.first !== null,
    second: b.second !== null,
    third: b.third !== null,
  })

  // [outcome, basesBefore, the occupancy the prior model produced]
  const cases: Array<
    [Parameters<typeof applyOutcome>[0], BaseState, ReturnType<typeof occupancyOf>]
  > = [
    ['HR', LOADED, { first: false, second: false, third: false }],
    ['3B', FIRST_ONLY, { first: false, second: false, third: true }],
    ['2B', FIRST_ONLY, { first: false, second: true, third: true }],
    ['2B', EMPTY, { first: false, second: true, third: false }],
    ['1B', LOADED, { first: true, second: true, third: true }],
    ['1B', EMPTY, { first: true, second: false, third: false }],
    [
      'IF1B',
      { first: null, second: 'r-second', third: null },
      { first: true, second: false, third: true },
    ],
    ['BB', FIRST_ONLY, { first: true, second: true, third: false }],
    // first & second occupied, third open — the old `if (!b.third)` branch, now
    // the merged ternary: all three bases end occupied, no run.
    [
      'BB',
      { first: 'r-first', second: 'r-second', third: null },
      { first: true, second: true, third: true },
    ],
    [
      'BB',
      { first: 'r-first', second: null, third: 'r-third' },
      { first: true, second: true, third: true },
    ],
    ['GB', LOADED, { first: true, second: true, third: true }],
    ['K', FIRST_ONLY, { first: true, second: false, third: false }],
  ]

  it.each(cases)('%s preserves prior occupancy', (outcome, basesBefore, expected) => {
    const { basesAfter } = applyOutcome(outcome, basesBefore, 0, BATTER)
    expect(occupancyOf(basesAfter)).toEqual(expected)
  })
})

/**
 * Identity reachability (SAN-44): every on-base runner — lead AND trailing — is
 * individually addressable after advancement, so SAN-16 can look each one up by
 * id. A runner id is never duplicated across bases, and ids are dropped (not
 * persisted) when a runner scores or the bases clear.
 */
describe('runner identity is preserved and individually reachable', () => {
  const distinct: BaseState = { first: 'runner-A', second: 'runner-B', third: 'runner-C' }

  it('a single advances each distinct runner one base and seats the batter on first', () => {
    expect(applyOutcome('1B', distinct, 0, 'batter-X').basesAfter).toEqual({
      first: 'batter-X',
      second: 'runner-A',
      third: 'runner-B',
    })
    // runner-C scored: its id is derivable from the play, not left on the bases.
  })

  it('a force out keeps every runner id exactly in place', () => {
    expect(applyOutcome('GB', distinct, 0, 'batter-X').basesAfter).toEqual(distinct)
  })

  it('never lands one runner id on two bases and seats a distinct batter', () => {
    const { basesAfter } = applyOutcome('1B', FIRST_ONLY, 0, 'batter-X')
    const onBase = [basesAfter.first, basesAfter.second, basesAfter.third].filter(
      (id): id is string => id !== null,
    )
    expect(onBase).toEqual(['batter-X', 'r-first']) // batter on first, prior runner on second
    expect(new Set(onBase).size).toBe(onBase.length) // no id on two bases at once
    expect(basesAfter.first).toBe('batter-X')
  })
})
