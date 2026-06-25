import { describe, expect, it } from 'vitest'
import {
  deriveDiffs,
  type HitterAttributes,
  type PitcherAttributes,
  resolveAtBat,
} from '../resolve'

const HITTER: HitterAttributes = { power: 3, contact: 3, speed: 3, eye: 3 }
const PITCHER: PitcherAttributes = { velocity: 3, movement: 3, awareness: 3, command: 3 }
const EMPTY = { first: null, second: null, third: null }
const BATTER = 'batter-1'

describe('deriveDiffs — batter − pitcher, clamped to [−5, +5]', () => {
  it('pairs each attribute matchup correctly', () => {
    const diffs = deriveDiffs(
      { power: 5, contact: 4, speed: 2, eye: 1 },
      { velocity: 1, movement: 2, awareness: 5, command: 3 },
    )
    expect(diffs).toEqual({ powerVel: 4, contactMov: 2, speedAwa: -3, eyeCmd: -2 })
  })

  it('clamps out-of-range inputs to [−5, +5]', () => {
    const diffs = deriveDiffs(
      { power: 50, contact: 0, speed: 3, eye: 3 },
      { velocity: 0, movement: 50, awareness: 3, command: 3 },
    )
    expect(diffs.powerVel).toBe(5)
    expect(diffs.contactMov).toBe(-5)
  })
})

describe('resolveAtBat — end-to-end authoritative resolution', () => {
  it('an exact match (difference 0) is a home run', () => {
    const result = resolveAtBat({
      pitch: 500,
      swing: 500,
      hitter: HITTER,
      pitcher: PITCHER,
      basesBefore: EMPTY,
      outsBefore: 0,
      batter: BATTER,
    })
    expect(result.difference).toBe(0)
    expect(result.outcome).toBe('HR')
    expect(result.runsScored).toBe(1)
    expect(result.rbi).toBe(1)
    expect(result.basesAfter).toEqual(EMPTY)
    expect(result.outsAfter).toBe(0)
  })

  it('the farthest guess (difference 499) is a strikeout that records an out', () => {
    const result = resolveAtBat({
      pitch: 1,
      swing: 500,
      hitter: HITTER,
      pitcher: PITCHER,
      basesBefore: EMPTY,
      outsBefore: 1,
      batter: BATTER,
    })
    expect(result.difference).toBe(499)
    expect(result.outcome).toBe('K')
    expect(result.outsAfter).toBe(2)
    expect(result.runsScored).toBe(0)
  })

  it('is deterministic — identical inputs yield identical outputs', () => {
    const input = {
      pitch: 123,
      swing: 456,
      hitter: HITTER,
      pitcher: PITCHER,
      basesBefore: EMPTY,
      outsBefore: 0,
      batter: BATTER,
    }
    expect(resolveAtBat(input)).toEqual(resolveAtBat(input))
  })

  it('threads basesBefore through and seats no runner on an out', () => {
    // A runner already on first; the duel resolves to a strikeout (difference
    // 499). The out preserves the on-base runner's identity and never seats the
    // batter — proving resolveAtBat forwards basesBefore/batter into applyOutcome.
    const result = resolveAtBat({
      pitch: 1,
      swing: 500,
      hitter: HITTER,
      pitcher: PITCHER,
      basesBefore: { first: 'on-first', second: null, third: null },
      outsBefore: 0,
      batter: BATTER,
    })
    expect(result.outcome).toBe('K')
    expect(result.basesAfter).toEqual({ first: 'on-first', second: null, third: null })
  })
})
