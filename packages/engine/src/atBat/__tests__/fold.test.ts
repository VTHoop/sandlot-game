import { describe, expect, it } from 'vitest'
import { DUEL_MAX, DUEL_MIN, foldDifference } from '../fold'

/**
 * The duel difference is a circular distance on a ring of 999 (numbers 1–999).
 * An odd ring has no antipode, so the fold `min(d, 999−d)` produces exactly
 * 0–499 — the engine's band range — with no clamp and no out-of-range value.
 * (See ADR-0016.)
 */
describe('foldDifference — circular distance on the 999 ring', () => {
  it('exposes the 1–999 domain bounds', () => {
    expect(DUEL_MIN).toBe(1)
    expect(DUEL_MAX).toBe(999)
  })

  it('is 0 when the two numbers match', () => {
    for (const n of [1, 2, 250, 500, 501, 999]) {
      expect(foldDifference(n, n)).toBe(0)
    }
  })

  it('is symmetric', () => {
    for (const [a, b] of [
      [1, 999],
      [12, 487],
      [500, 1],
      [333, 666],
    ]) {
      expect(foldDifference(a, b)).toBe(foldDifference(b, a))
    }
  })

  it('treats 1 and 999 as adjacent (wraparound)', () => {
    expect(foldDifference(1, 999)).toBe(1)
    expect(foldDifference(2, 999)).toBe(2)
    expect(foldDifference(999, 3)).toBe(3)
  })

  it('reaches the maximum distance of 499 (no antipode at 500)', () => {
    // 1↔500 (raw 499) and 1↔501 (raw 500 → 999−500=499) both fold to 499.
    expect(foldDifference(1, 500)).toBe(499)
    expect(foldDifference(1, 501)).toBe(499)
  })

  it('stays within 0–499 across the entire 1–999 × 1–999 domain', () => {
    let min = Number.POSITIVE_INFINITY
    let max = Number.NEGATIVE_INFINITY
    for (let a = DUEL_MIN; a <= DUEL_MAX; a++) {
      for (let b = DUEL_MIN; b <= DUEL_MAX; b++) {
        const d = foldDifference(a, b)
        if (d < min) min = d
        if (d > max) max = d
      }
    }
    expect(min).toBe(0)
    expect(max).toBe(499)
  })
})
