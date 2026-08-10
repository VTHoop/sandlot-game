import { describe, expect, it } from 'vitest'
import { isHitBand, OUTCOME_BAND_KEYS } from '../outcomes'

describe('OUTCOME_BAND_KEYS', () => {
  it('lists every band exactly once in best → worst stack order', () => {
    expect(OUTCOME_BAND_KEYS).toEqual(['HR', '3B', '2B', '1B', 'IF1B', 'BB', 'FO', 'PO', 'GB', 'K'])
  })

  it('has no duplicate keys', () => {
    expect(new Set(OUTCOME_BAND_KEYS).size).toBe(OUTCOME_BAND_KEYS.length)
  })
})

describe('isHitBand', () => {
  // Every band classified, from the tuple rather than a second hand-written list:
  // a band added to the stack lands here unclassified and fails, instead of
  // quietly defaulting to "not a hit" wherever hit totals are counted.
  it('classifies every band in the stack', () => {
    const classified = Object.fromEntries(OUTCOME_BAND_KEYS.map((b) => [b, isHitBand(b)]))
    expect(classified).toEqual({
      HR: true,
      '3B': true,
      '2B': true,
      '1B': true,
      IF1B: true,
      // The boundary the box score turns on: a walk reaches base and is not a hit.
      BB: false,
      FO: false,
      PO: false,
      GB: false,
      K: false,
    })
  })

  it('draws the line at IF1B — the hits are exactly the top of the stack', () => {
    const hits = OUTCOME_BAND_KEYS.filter(isHitBand)
    expect(hits).toEqual(OUTCOME_BAND_KEYS.slice(0, OUTCOME_BAND_KEYS.indexOf('IF1B') + 1))
  })
})
