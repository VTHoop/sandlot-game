import { type Point, spotPoint } from './fieldMovement'
import { FieldSpot } from './scenario'

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

/**
 * Contact point for every flight, and the origin the camera measures reach from.
 * Taken from the shared base geometry rather than restated, so the ball leaves the
 * bat from exactly where the plate is drawn even if the diamond ever moves.
 */
export const PLATE: Point = spotPoint(FieldSpot.Home)

/** The quadratic control point: the midpoint, pushed perpendicular by `bow`. */
function control(zone: LandingZone): Point {
  const vx = zone.x - PLATE.x
  const vy = zone.y - PLATE.y
  const length = Math.hypot(vx, vy) || 1
  return {
    x: (PLATE.x + zone.x) / 2 + (-vy / length) * zone.bow,
    y: (PLATE.y + zone.y) / 2 + (vx / length) * zone.bow,
  }
}

/** The ball's position at `u` (0 = contact, 1 = landing). */
export function ballPointAt(zone: LandingZone, u: number): Point {
  const c = control(zone)
  const m = 1 - u
  return {
    x: m * m * PLATE.x + 2 * m * u * c.x + u * u * zone.x,
    y: m * m * PLATE.y + 2 * m * u * c.y + u * u * zone.y,
  }
}

/** The ball's radius at `u` — altitude, in the only axis a plan view has left. */
export function ballRadiusAt(zone: LandingZone, u: number): number {
  return BALL_RADIUS + zone.lift * Math.sin(Math.PI * u)
}

/** The whole flight as an SVG quadratic path, for the trail stroke. */
export function ballTrailPath(zone: LandingZone): string {
  const c = control(zone)
  return `M ${PLATE.x} ${PLATE.y} Q ${c.x} ${c.y} ${zone.x} ${zone.y}`
}
