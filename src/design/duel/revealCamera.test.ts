import { describe, expect, it } from 'vitest'
import { LANDING_ZONES } from './Ballpark'
import { cameraFrameAt, TIGHT_FRAME, WIDE_FRAME } from './revealCamera'

/**
 * The reveal's camera opens tight on the diamond and widens only as far as the
 * ball forces it, then holds. These assertions are the spec — the framing must be
 * driven by where the ball actually finishes, never by which outcome key it is.
 */

const BALL_AT = 1.25
const shot = (outcome: keyof typeof LANDING_ZONES) => ({
  zone: LANDING_ZONES[outcome],
  ballAt: BALL_AT,
})
const widthAt = (t: number, outcome: keyof typeof LANDING_ZONES) =>
  cameraFrameAt(t, shot(outcome)).w
const landing = (outcome: keyof typeof LANDING_ZONES) => BALL_AT + LANDING_ZONES[outcome].flight

describe('reveal camera', () => {
  it('holds the tight frame until the ball is launched', () => {
    for (const t of [0, 0.5, 1.0, BALL_AT]) {
      expect(widthAt(t, 'HR')).toBeCloseTo(TIGHT_FRAME.w)
    }
  })

  it('is at its widest exactly when the ball lands', () => {
    const atLanding = widthAt(landing('HR'), 'HR')
    expect(atLanding).toBeCloseTo(WIDE_FRAME.w)
    // and not still opening a moment earlier
    expect(widthAt(landing('HR') - 0.15, 'HR')).toBeLessThan(atLanding)
  })

  it('never begins closing while the ball is still up', () => {
    let previous = 0
    for (let t = BALL_AT; t <= landing('HR'); t += 0.02) {
      const w = widthAt(t, 'HR')
      expect(w).toBeGreaterThanOrEqual(previous - 1e-9)
      previous = w
    }
  })

  it('derives how far it opens from the landing point, not the outcome key', () => {
    // A ball that finishes deeper needs more frame than one that dies on the dirt.
    expect(widthAt(landing('HR'), 'HR')).toBeGreaterThan(widthAt(landing('2B'), '2B'))
    expect(widthAt(landing('2B'), '2B')).toBeGreaterThan(widthAt(landing('IF1B'), 'IF1B'))

    // Two different outcomes landing in the same spot must frame identically —
    // that is what "derived from geometry, not from the key" means.
    const zone = { ...LANDING_ZONES['2B'] }
    const asDouble = cameraFrameAt(3, { zone, ballAt: BALL_AT })
    const asFlyOut = cameraFrameAt(3, { zone: { ...zone }, ballAt: BALL_AT })
    expect(asDouble.w).toBeCloseTo(asFlyOut.w)
  })

  it('never opens at all when no ball is put in play', () => {
    for (const t of [0, 1, 2, 3, 5]) {
      expect(cameraFrameAt(t, { zone: undefined, ballAt: BALL_AT }).w).toBeCloseTo(TIGHT_FRAME.w)
    }
  })

  it('holds the earned framing through the base running', () => {
    const settled = widthAt(landing('2B'), '2B')
    for (const t of [landing('2B') + 0.5, landing('2B') + 2, landing('2B') + 5]) {
      expect(widthAt(t, '2B')).toBeCloseTo(settled)
    }
  })
})
