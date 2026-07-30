import type { Point } from './fieldMovement'

/**
 * Ball flight across the reveal's park.
 *
 * The park is drawn from directly overhead, so screen-up is center field, not the
 * sky: a parabola would read as the ball flying at the wall rather than into the
 * air. Height is therefore carried by the ball's RADIUS — it swells as it climbs
 * and shrinks as it falls — which doubles as the only cue that separates a fly ball
 * from a grounder before either one lands. The path itself only bows sideways, the
 * natural slice off a bat, so a dead-centre home run is not a vertical line.
 */

/** Where a batted ball finishes, and how it gets there. */
export interface LandingZone {
  x: number
  y: number
  /** Lateral bow away from a straight plate-to-landing line, in park units. */
  bow: number
  /** Peak radius added at the top of the flight; 0 never leaves the ground. */
  lift: number
  /** Seconds from contact to landing. */
  flight: number
}

/** The ball's resting radius, in park units. */
export const BALL_RADIUS = 4.2

/** The ball's position at `u` (0 = contact, 1 = landing). */
export function ballPointAt(_zone: LandingZone, _u: number): Point {
  throw new Error('not implemented')
}

/** The ball's radius at `u` — altitude, in the only axis a plan view has left. */
export function ballRadiusAt(_zone: LandingZone, _u: number): number {
  throw new Error('not implemented')
}

/** The whole flight as an SVG quadratic path, for the trail stroke. */
export function ballTrailPath(_zone: LandingZone): string {
  throw new Error('not implemented')
}
