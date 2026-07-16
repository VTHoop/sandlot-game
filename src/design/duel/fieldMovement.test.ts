import { describe, expect, it } from 'vitest'
import { movementPath } from './fieldMovement'
import { FieldSpot } from './scenario'

const HOME = { x: 120, y: 210 }
const FIRST = { x: 205, y: 125 }
const SECOND = { x: 120, y: 40 }
const THIRD = { x: 35, y: 125 }

describe('movementPath', () => {
  it('holds a runner who stays put: one waypoint, no travel', () => {
    const path = movementPath({ from: FieldSpot.Second, to: FieldSpot.Second })
    expect(path.travels).toBe(false)
    expect(path.retired).toBe(false)
    expect(path.scored).toBe(false)
    expect(path.start).toEqual(SECOND)
    expect(path.waypoints).toEqual([SECOND])
  })

  it('marks a retired runner: no travel, flagged out, sits at the start', () => {
    const path = movementPath({ from: FieldSpot.Batter, to: FieldSpot.Out })
    expect(path.travels).toBe(false)
    expect(path.retired).toBe(true)
    expect(path.scored).toBe(false)
    expect(path.waypoints).toEqual([HOME])
  })

  it('rounds the bases for a runner scoring from second: second → third → home', () => {
    const path = movementPath({ from: FieldSpot.Second, to: FieldSpot.Home })
    expect(path.travels).toBe(true)
    expect(path.scored).toBe(true)
    expect(path.waypoints).toEqual([SECOND, THIRD, HOME])
  })

  it('walks the batter from the plate to first', () => {
    const path = movementPath({ from: FieldSpot.Batter, to: FieldSpot.First })
    expect(path.travels).toBe(true)
    expect(path.scored).toBe(false)
    expect(path.waypoints).toEqual([HOME, FIRST])
  })

  it('carries a runner from first all the way around to score', () => {
    const path = movementPath({ from: FieldSpot.First, to: FieldSpot.Home })
    expect(path.scored).toBe(true)
    expect(path.waypoints).toEqual([FIRST, SECOND, THIRD, HOME])
  })
})
