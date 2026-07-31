import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { OUTCOME_LADDER, type OutcomeKey } from '../../components/ui/OutcomeLadder'
import {
  Ballpark,
  type BattedOutcome,
  HIT_SPRAY,
  LANDING_ZONES,
  landingZone,
  PARK_PATHS,
  PARK_VIEWBOX,
} from './Ballpark'
import { type Point, spotPoint } from './fieldMovement'
import { FieldSpot } from './scenario'

afterEach(cleanup)

/**
 * The four control points of `M a C b, c, d`. Points carry named axes rather than
 * tuples indexed by a variable, matching the geometry the rest of the reveal speaks
 * in — and leaving no computed key to read as an object-injection sink.
 */
const cubicPoints = (path: string): [Point, Point, Point, Point] => {
  const n = path.match(/-?\d+(\.\d+)?/g)?.map(Number) ?? []
  return [
    { x: n[0], y: n[1] },
    { x: n[2], y: n[3] },
    { x: n[4], y: n[5] },
    { x: n[6], y: n[7] },
  ]
}

/** A cubic's midpoint in y — where `M a C b, c, d` reaches deepest into the outfield. */
const cubicMidY = (path: string): number => {
  const [p0, p1, p2, p3] = cubicPoints(path)
  return (p0.y + 3 * p1.y + 3 * p2.y + p3.y) / 8
}

/** Sample a cubic `M a C b, c, d` and read its y where it crosses a given x.
 * Returns null when x lies outside the curve's span (e.g. the foul corners). */
const curveYAt = (path: string, x: number): number | null => {
  const [p0, p1, p2, p3] = cubicPoints(path)
  const at = (t: number): Point => {
    const m = 1 - t
    const [w0, w1, w2, w3] = [m ** 3, 3 * m * m * t, 3 * m * t * t, t ** 3]
    return {
      x: w0 * p0.x + w1 * p1.x + w2 * p2.x + w3 * p3.x,
      y: w0 * p0.y + w1 * p1.y + w2 * p2.y + w3 * p3.y,
    }
  }
  const samples = Array.from({ length: 1001 }, (_, i) => at(i / 1000))
  const xs = samples.map((s) => s.x)
  if (x < Math.min(...xs) || x > Math.max(...xs)) return null
  return samples.reduce((best, s) => (Math.abs(s.x - x) < Math.abs(best.x - x) ? s : best)).y
}

describe('Ballpark landing zones', () => {
  // The whole premise of the overhaul is that WHERE a ball lands names the outcome.
  // That only holds if each zone actually sits in the region it claims — including
  // at the extremes of the deterministic spray, not just at its centre.
  const deepest = (key: BattedOutcome) => landingZone(key).y + HIT_SPRAY.y
  const shallowest = (key: BattedOutcome) => landingZone(key).y - HIT_SPRAY.y

  it('gives every outcome that puts a ball in play somewhere to land', () => {
    const noBallInPlay: OutcomeKey[] = ['BB', 'K']
    for (const key of OUTCOME_LADDER) {
      const zoned = key in LANDING_ZONES
      expect(zoned).toBe(!noBallInPlay.includes(key))
    }
  })

  it.each(['IF1B', 'GB', 'PO'] as const)('keeps a %s on the infield', (key) => {
    const dirt = curveYAt(PARK_PATHS.infieldDirt, landingZone(key).x)
    expect(dirt).not.toBeNull()
    expect(shallowest(key)).toBeGreaterThan(dirt as number)
  })

  it.each(['1B', '2B', 'FO'] as const)('clears the infield dirt on a %s', (key) => {
    // Regression: 1B originally sat at y=96, which is ON the dirt — a plain single
    // and an infield hit landed in the same region and stopped telling them apart.
    const dirt = curveYAt(PARK_PATHS.infieldDirt, landingZone(key).x)
    expect(dirt).not.toBeNull()
    expect(deepest(key)).toBeLessThan(dirt as number)
  })

  it('drops a triple past the dirt entirely, down in the corner', () => {
    expect(curveYAt(PARK_PATHS.infieldDirt, landingZone('3B').x)).toBeNull()
  })

  it('puts a home run beyond the fence and everything else inside it', () => {
    const overFence = (key: BattedOutcome) => {
      const fence = curveYAt(PARK_PATHS.fence, landingZone(key).x)
      return fence === null ? false : landingZone(key).y < fence
    }
    expect(overFence('HR')).toBe(true)
    for (const key of ['3B', '2B', '1B', 'IF1B', 'FO', 'PO', 'GB'] as const)
      expect(overFence(key)).toBe(false)
  })
})

describe('Ballpark geometry', () => {
  it('opens a window past the bases, so a batted ball has somewhere to land', () => {
    const [, minY, , height] = PARK_VIEWBOX.split(' ').map(Number)
    // The old reveal drew into a 0–240 square that stopped at the basepaths; the
    // park has to extend well above second base for an outfield to exist at all.
    expect(minY).toBeLessThan(0)
    expect(spotPoint(FieldSpot.Second).y - minY).toBeGreaterThan(100)
    expect(height).toBeGreaterThan(240)
  })

  it('runs the infield dirt PAST second base, never short of it', () => {
    // Regression: the arc used to crest in front of the bag, which read as a field
    // whose dirt gave out halfway. Smaller y is deeper into the outfield.
    const crest = cubicMidY(PARK_PATHS.infieldDirt)
    expect(crest).toBeLessThan(spotPoint(FieldSpot.Second).y)
  })

  it('nests the dirt inside the warning track inside the fence', () => {
    const dirt = cubicMidY(PARK_PATHS.infieldDirt)
    const track = cubicMidY(PARK_PATHS.warningTrack)
    const fence = cubicMidY(PARK_PATHS.fence)
    // One shape language, three depths — the outfield must never collapse to nothing.
    expect(dirt).toBeGreaterThan(track)
    expect(track).toBeGreaterThan(fence)
  })

  it('sets every bag from the shared field geometry, not a second copy of it', () => {
    const { container } = render(<Ballpark />)
    const centres = [...container.querySelectorAll('rect')].map((r) => ({
      x: Number(r.getAttribute('x')) + Number(r.getAttribute('width')) / 2,
      y: Number(r.getAttribute('y')) + Number(r.getAttribute('height')) / 2,
    }))
    for (const spot of [FieldSpot.First, FieldSpot.Second, FieldSpot.Third, FieldSpot.Home]) {
      const { x, y } = spotPoint(spot)
      expect(centres).toContainEqual({ x, y })
    }
  })

  it('draws overlay children into the park’s own coordinate space', () => {
    render(
      <Ballpark>
        <circle data-testid="overlay" cx={120} cy={40} r={8} />
      </Ballpark>,
    )
    expect(screen.getByTestId('overlay').closest('svg')?.getAttribute('viewBox')).toBe(PARK_VIEWBOX)
  })

  it('stays decorative — the reveal speaks its outcome in text, not in the field', () => {
    const { container } = render(<Ballpark />)
    expect(container.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true')
    expect(screen.queryByRole('img')).toBeNull()
  })
})
