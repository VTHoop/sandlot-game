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
 * The base path in running order: the batter starts at the plate (`Batter`, index
 * 0) and a scorer returns to it as `Home` (the far end, one lap later); a runner
 * already on base starts at their base. A journey is the inclusive slice between its
 * endpoints, so it expands into every base it passes through. Sliced by value, never
 * indexed by a computed key — no object-injection sink. `Out` is absent: a retired
 * runner does not travel (handled before this sequence is consulted).
 */
const RUNNING_SEQUENCE: readonly FieldSpot[] = [
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

  const startIdx = RUNNING_SEQUENCE.indexOf(from)
  const endIdx = RUNNING_SEQUENCE.indexOf(to)
  const waypoints = RUNNING_SEQUENCE.slice(startIdx, endIdx + 1).map(pointOf)
  return { start, waypoints, travels: true, scored: to === FieldSpot.Home, retired: false }
}

/** Seconds a token spends travelling, one beat per base it passes, floored so a
 * single-base move still reads. */
export function travelDuration(path: MovementPath): number {
  return Math.max(0.6, 0.5 * (path.waypoints.length - 1))
}

/** Per-runner start stagger (seconds) so tokens step off in sequence, not as a blob. */
export const RUNNER_STAGGER = 0.12

/**
 * When the last run actually crosses the plate, relative to `runnersAt`: the max
 * over the scoring tokens of (their staggered start + travel). The reveal ticks the
 * scoreboard here so a multi-run play (e.g. a grand slam) doesn't add the runs while
 * the trailing tokens are still between bases. Returns `runnersAt` when nothing scores.
 */
export function latestScoringArrival(movements: RunnerMovement[], runnersAt: number): number {
  return movements.reduce((latest, movement, index) => {
    const path = movementPath(movement)
    if (!path.scored) return latest
    return Math.max(latest, runnersAt + index * RUNNER_STAGGER + travelDuration(path))
  }, runnersAt)
}
