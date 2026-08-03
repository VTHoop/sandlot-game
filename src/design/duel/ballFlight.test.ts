import { describe, expect, it } from 'vitest'
import { LANDING_ZONES } from './Ballpark'
import { ballPointAt, ballRadiusAt } from './ballFlight'

/**
 * The park is drawn from directly overhead, so "up" on screen is center field, not
 * the sky. A parabola would therefore read as the ball flying toward the wall
 * rather than into the air. Height is carried by the ball's SIZE instead — which
 * is also the only thing separating a fly ball from a grounder before either lands.
 */
describe('ball flight', () => {
  it('swells at the top of an air ball and comes back down to earth', () => {
    const zone = LANDING_ZONES.HR
    const launch = ballRadiusAt(zone, 0)
    const peak = ballRadiusAt(zone, 0.5)
    const arrival = ballRadiusAt(zone, 1)
    expect(peak).toBeGreaterThan(launch)
    expect(peak).toBeGreaterThan(arrival)
    expect(arrival).toBeCloseTo(launch)
  })

  it('never lifts a ground ball off the ground', () => {
    const zone = LANDING_ZONES.GB
    const radii = [0, 0.25, 0.5, 0.75, 1].map((u) => ballRadiusAt(zone, u))
    for (const r of radii) expect(r).toBeCloseTo(radii[0])
  })

  it('carries a home run higher than a ball that dies on the infield', () => {
    expect(ballRadiusAt(LANDING_ZONES.HR, 0.5)).toBeGreaterThan(
      ballRadiusAt(LANDING_ZONES.IF1B, 0.5),
    )
  })

  it('leaves the plate and arrives at the landing zone', () => {
    const zone = LANDING_ZONES['2B']
    const start = ballPointAt(zone, 0)
    const end = ballPointAt(zone, 1)
    expect(start.x).toBeCloseTo(120)
    expect(start.y).toBeCloseTo(210)
    expect(end.x).toBeCloseTo(zone.x)
    expect(end.y).toBeCloseTo(zone.y)
  })

  it('bows the path sideways rather than arcing it up the middle', () => {
    // A dead-centre home run must not render as a vertical laser line.
    const zone = LANDING_ZONES.HR
    const straightX = 120 + (zone.x - 120) * 0.5
    expect(Math.abs(ballPointAt(zone, 0.5).x - straightX)).toBeGreaterThan(4)
  })
})
