import { describe, expect, it } from 'vitest'
import { OUTCOME_BAND_KEYS } from '../outcomes'

describe('OUTCOME_BAND_KEYS', () => {
  it('lists every band exactly once in best → worst stack order', () => {
    expect(OUTCOME_BAND_KEYS).toEqual(['HR', '3B', '2B', '1B', 'IF1B', 'BB', 'FO', 'PO', 'GB', 'K'])
  })

  it('has no duplicate keys', () => {
    expect(new Set(OUTCOME_BAND_KEYS).size).toBe(OUTCOME_BAND_KEYS.length)
  })
})
