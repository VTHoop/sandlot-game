import { describe, expect, it } from 'vitest'
import { latestScoringArrival, movementPath } from './fieldMovement'
import { FieldSpot, type RunnerMovement } from './scenario'

const HOME = { x: 120, y: 210 }
const FIRST = { x: 205, y: 125 }
const SECOND = { x: 120, y: 40 }
const THIRD = { x: 35, y: 125 }

describe('movementPath', () => {
  it('holds a runner who stays put: one waypoint, no travel', () => {
    const path = movementPath({ from: FieldSpot.Second, to: FieldSpot.Second, retired: false })
    expect(path.travels).toBe(false)
    expect(path.retired).toBe(false)
    expect(path.scored).toBe(false)
    expect(path.start).toEqual(SECOND)
    expect(path.waypoints).toEqual([SECOND])
  })

  it('marks a retired runner: no travel, flagged out, sits at the start', () => {
    const path = movementPath({ from: FieldSpot.Batter, to: FieldSpot.Batter, retired: true })
    expect(path.travels).toBe(false)
    expect(path.retired).toBe(true)
    expect(path.scored).toBe(false)
    expect(path.waypoints).toEqual([HOME])
  })

  it('runs a forced runner to the bag it was out at: batter forced at first travels there', () => {
    const path = movementPath({ from: FieldSpot.Batter, to: FieldSpot.First, retired: true })
    expect(path.travels).toBe(true)
    expect(path.retired).toBe(true)
    expect(path.scored).toBe(false)
    expect(path.waypoints).toEqual([HOME, FIRST])
  })

  it('never scores a runner out at home (FC_HOME): travels to the plate but is not a run', () => {
    const path = movementPath({ from: FieldSpot.Third, to: FieldSpot.Home, retired: true })
    expect(path.travels).toBe(true)
    expect(path.retired).toBe(true)
    expect(path.scored).toBe(false)
    expect(path.waypoints).toEqual([THIRD, HOME])
  })

  it('rounds the bases for a runner scoring from second: second → third → home', () => {
    const path = movementPath({ from: FieldSpot.Second, to: FieldSpot.Home, retired: false })
    expect(path.travels).toBe(true)
    expect(path.scored).toBe(true)
    expect(path.waypoints).toEqual([SECOND, THIRD, HOME])
  })

  it('walks the batter from the plate to first', () => {
    const path = movementPath({ from: FieldSpot.Batter, to: FieldSpot.First, retired: false })
    expect(path.travels).toBe(true)
    expect(path.scored).toBe(false)
    expect(path.waypoints).toEqual([HOME, FIRST])
  })

  it('carries a runner from first all the way around to score', () => {
    const path = movementPath({ from: FieldSpot.First, to: FieldSpot.Home, retired: false })
    expect(path.scored).toBe(true)
    expect(path.waypoints).toEqual([FIRST, SECOND, THIRD, HOME])
  })
})

describe('latestScoringArrival', () => {
  it('returns runnersAt when nothing scores', () => {
    const outs: RunnerMovement[] = [
      { from: FieldSpot.First, to: FieldSpot.Second, retired: true },
      { from: FieldSpot.Batter, to: FieldSpot.First, retired: true },
    ]
    expect(latestScoringArrival(outs, 3)).toBe(3)
  })

  it('ignores non-scoring tokens, timing off the runner who scores', () => {
    // A double: the runner scores from second (3 waypoints → 1.0s), the batter
    // stops at second (not a scorer). Index 0, no stagger → 1.0s after runnersAt.
    const double: RunnerMovement[] = [
      { from: FieldSpot.Second, to: FieldSpot.Home, retired: false },
      { from: FieldSpot.Batter, to: FieldSpot.Second, retired: false },
    ]
    expect(latestScoringArrival(double, 0)).toBeCloseTo(1.0)
  })

  it('waits for the last, deepest scorer on a grand slam', () => {
    // Four scorers; the batter (index 3) travels the full circuit (5 waypoints →
    // 2.0s) after a 3-step stagger (0.36s): 2.36s, the max across all four.
    const grandSlam: RunnerMovement[] = [
      { from: FieldSpot.Third, to: FieldSpot.Home, retired: false },
      { from: FieldSpot.Second, to: FieldSpot.Home, retired: false },
      { from: FieldSpot.First, to: FieldSpot.Home, retired: false },
      { from: FieldSpot.Batter, to: FieldSpot.Home, retired: false },
    ]
    expect(latestScoringArrival(grandSlam, 0)).toBeCloseTo(2.36)
  })
})
