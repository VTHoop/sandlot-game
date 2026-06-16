import { describe, expect, it } from 'vitest'
import type { CellDiffs } from '../../harness/types'
import { OUTCOME_BAND_KEYS, type OutcomeBandKey } from '../../outcomes'
import { assembleBackHalf } from '../../rangeFinder/backHalf'
import { assembleFrontHalf } from '../../rangeFinder/frontHalf'
import { classifyOutcome } from '../classify'

// Even matchup (all differentials 0). Tests derive expected boundaries from the
// SAME assemblers the classifier uses, so a SAN-15 retune of the width tables
// never breaks this suite — it asserts the partition contract, not magic numbers.
const EVEN: CellDiffs = { powerVel: 0, speedAwa: 0, eyeCmd: 0, contactMov: 0 }

function bandsFor(
  diffs: CellDiffs,
): ReadonlyArray<readonly [OutcomeBandKey, { lo: number; hi: number }]> {
  const front = assembleFrontHalf(diffs)
  const back = assembleBackHalf(
    { powerVel: diffs.powerVel, contactMov: diffs.contactMov },
    front.BB.hi + 1,
  )
  return [
    ['HR', front.HR],
    ['3B', front['3B']],
    ['2B', front['2B']],
    ['1B', front['1B']],
    ['IF1B', front.IF1B],
    ['BB', front.BB],
    ['FO', back.FO],
    ['PO', back.PO],
    ['GB', back.GB],
    ['K', back.K],
  ]
}

describe('classifyOutcome — maps a 0–499 difference onto the band stack', () => {
  it('returns each band key for its lo, mid, and hi positions', () => {
    for (const [key, band] of bandsFor(EVEN)) {
      const mid = Math.floor((band.lo + band.hi) / 2)
      for (const pos of [band.lo, mid, band.hi]) {
        expect(classifyOutcome(pos, EVEN)).toBe(key)
      }
    }
  })

  it('classifies every position 0–499 into exactly the band that contains it', () => {
    const bands = bandsFor(EVEN)
    for (let pos = 0; pos <= 499; pos++) {
      const expected = bands.find(([, band]) => pos >= band.lo && pos <= band.hi)
      expect(expected, `position ${pos} fell in no band`).toBeDefined()
      expect(classifyOutcome(pos, EVEN)).toBe(expected?.[0])
    }
  })

  it('places the closest guess (0) in HR and the farthest (499) in K', () => {
    expect(classifyOutcome(0, EVEN)).toBe('HR')
    expect(classifyOutcome(499, EVEN)).toBe('K')
  })

  it('covers all ten canonical outcome bands', () => {
    const produced = new Set<OutcomeBandKey>()
    for (let pos = 0; pos <= 499; pos++) produced.add(classifyOutcome(pos, EVEN))
    expect([...produced].sort()).toEqual([...OUTCOME_BAND_KEYS].sort())
  })

  it('throws when the difference is outside the assembled 0–499 range', () => {
    expect(() => classifyOutcome(500, EVEN)).toThrow(RangeError)
    expect(() => classifyOutcome(-1, EVEN)).toThrow(RangeError)
  })
})
