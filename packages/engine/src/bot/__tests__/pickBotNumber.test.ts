import { describe, expect, it } from 'vitest'
import { DUEL_MAX, DUEL_MIN, isDuelNumber } from '../../atBat'
import { pickBotNumber } from '..'

describe('pickBotNumber — the one selection policy both bots draw from (SAN-58)', () => {
  it('maps the bottom of the rng contract to DUEL_MIN', () => {
    expect(pickBotNumber(() => 0)).toBe(DUEL_MIN)
  })

  it('maps the top of the rng contract to DUEL_MAX', () => {
    expect(pickBotNumber(() => 1 - Number.EPSILON)).toBe(DUEL_MAX)
  })

  it('emits a valid duel number for every draw across [0, 1)', () => {
    for (let i = 0; i < 1000; i += 1) {
      expect(isDuelNumber(pickBotNumber(() => i / 1000))).toBe(true)
    }
  })

  it('is a function of the draw alone: the same draw always yields the same number', () => {
    expect(pickBotNumber(() => 0.4242)).toBe(pickBotNumber(() => 0.4242))
  })

  it('defaults to Math.random and still only emits valid duel numbers', () => {
    for (let i = 0; i < 2000; i += 1) {
      expect(isDuelNumber(pickBotNumber())).toBe(true)
    }
  })
})
