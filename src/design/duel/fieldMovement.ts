import { FieldSpot, type RunnerMovement } from './scenario'

/**
 * Base-running geometry for the reveal's field animation. Pure (no React): maps a
 * {@link RunnerMovement} to the waypoints a token travels, in the 240×240 viewBox
 * the field diagram uses. Kept out of the component so the path math is unit-tested
 * and the component stays a thin renderer.
 */

/** A point in the field's 240×240 coordinate space. */
export interface Point {
  x: number
  y: number
}

/**
 * The diamond corners, at the center of each base. `Batter` and `Home` share the
 * plate coordinate but are distinct spots: the batter STARTS there, a scorer ENDS
 * there — the running order (below) tells them apart.
 */
const SPOT_POINT = new Map<FieldSpot, Point>([
  [FieldSpot.Batter, { x: 120, y: 210 }],
  [FieldSpot.First, { x: 205, y: 125 }],
  [FieldSpot.Second, { x: 120, y: 40 }],
  [FieldSpot.Third, { x: 35, y: 125 }],
  [FieldSpot.Home, { x: 120, y: 210 }],
])

/**
 * Position along the counter-clockwise base path, so a journey expands into the
 * bases it passes through. The batter starts at 0 (the plate) and a scorer lands at
 * 4 (the plate again, one lap later); a runner already on base starts at their
 * base's index. `Out` has no path index — a retired runner does not travel.
 */
const RUNNING_ORDER = new Map<FieldSpot, number>([
  [FieldSpot.Batter, 0],
  [FieldSpot.First, 1],
  [FieldSpot.Second, 2],
  [FieldSpot.Third, 3],
  [FieldSpot.Home, 4],
])

/** The spot occupying each running-order index, for expanding a journey's path. */
const ORDER_SPOT: readonly FieldSpot[] = [
  FieldSpot.Batter,
  FieldSpot.First,
  FieldSpot.Second,
  FieldSpot.Third,
  FieldSpot.Home,
]

const pointOf = (spot: FieldSpot): Point => {
  const point = SPOT_POINT.get(spot)
  if (!point) throw new RangeError(`no field point for spot ${spot}`)
  return point
}

/** How a movement should render: a held/retired runner sits, everyone else travels. */
export interface MovementPath {
  /** Where the token begins (always the `from` point). */
  start: Point
  /** Every waypoint from start through the destination, inclusive. */
  waypoints: Point[]
  /** True when the token moves; false for a hold (`from === to`) or an out. */
  travels: boolean
  /** True when this journey ends in a run crossing the plate. */
  scored: boolean
  /** True when the runner was retired on the play. */
  retired: boolean
}

/**
 * Expand a runner movement into its animation path. A hold (`from === to`) or an
 * `Out` yields a single stationary point; any advance/score walks the running order
 * from the start index to the end index, emitting each base center on the way — so
 * a runner scoring from first rounds second and third before reaching home.
 */
export function movementPath(movement: RunnerMovement): MovementPath {
  const { from, to } = movement
  const start = pointOf(from)
  const retired = to === FieldSpot.Out
  const held = from === to

  if (retired || held) {
    return { start, waypoints: [start], travels: false, scored: false, retired }
  }

  const startIdx = RUNNING_ORDER.get(from) ?? 0
  const endIdx = RUNNING_ORDER.get(to) ?? startIdx
  const waypoints: Point[] = []
  for (let idx = startIdx; idx <= endIdx; idx++) {
    waypoints.push(pointOf(ORDER_SPOT[idx]))
  }
  return { start, waypoints, travels: true, scored: to === FieldSpot.Home, retired: false }
}
