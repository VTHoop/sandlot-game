import { describe, expect, it } from 'vitest'
import { isValidDuelNumber } from './duelNumber'

describe('isValidDuelNumber', () => {
  it.each([
    ['1', true],
    ['472', true],
    ['1000', true],
    ['', false],
    ['0', false],
    ['1001', false],
  ])('"%s" → %s', (raw, expected) => {
    expect(isValidDuelNumber(raw)).toBe(expected)
  })
})
