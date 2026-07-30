import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { Ballpark, HIT_SPRAY, HIT_TARGETS, PARK_PATHS, PARK_VIEWBOX } from './Ballpark'
import { spotPoint } from './fieldMovement'
import { FieldSpot } from './scenario'

afterEach(cleanup)

/** A cubic's midpoint on one axis — where `M a C b, c, d` is deepest. */
const cubicMidpoint = (path: string, axis: 0 | 1): number => {
  const n = path.match(/-?\d+(\.\d+)?/g)?.map(Number) ?? []
  const [p0, p1, p2, p3] = [
    [n[0], n[1]],
    [n[2], n[3]],
    [n[4], n[5]],
    [n[6], n[7]],
  ]
  return (p0[axis] + 3 * p1[axis] + 3 * p2[axis] + p3[axis]) / 8
}

/** Sample a cubic `M a C b, c, d` and read its y where it crosses a given x.
 * Returns null when x lies outside the curve's span (e.g. the foul corners). */
const curveYAt = (path: string, x: number): number | null => {
  const n = path.match(/-?\d+(\.\d+)?/g)?.map(Number) ?? []
  const p: [number, number][] = [
    [n[0], n[1]],
    [n[2], n[3]],
    [n[4], n[5]],
    [n[6], n[7]],
  ]
  const at = (t: number, axis: 0 | 1) => {
    const m = 1 - t
    return (
      m ** 3 * p[0][axis] +
      3 * m * m * t * p[1][axis] +
      3 * m * t * t * p[2][axis] +
      t ** 3 * p[3][axis]
    )
  }
  const samples = Array.from({ length: 1001 }, (_, i) => [at(i / 1000, 0), at(i / 1000, 1)])
  const xs = samples.map(([sx]) => sx)
  if (x < Math.min(...xs) || x > Math.max(...xs)) return null
  return samples.reduce((best, s) => (Math.abs(s[0] - x) < Math.abs(best[0] - x) ? s : best))[1]
}

describe('Ballpark hit landing zones', () => {
  // The whole premise of the overhaul is that WHERE a ball lands names the outcome.
  // That only holds if each zone actually sits in the region it claims — including
  // at the extremes of the deterministic spray, not just at its centre.
  const deepest = (key: keyof typeof HIT_TARGETS) => HIT_TARGETS[key].y + HIT_SPRAY.y

  it('drops an infield hit on the dirt, where it belongs', () => {
    const { x } = HIT_TARGETS.IF1B
    const dirt = curveYAt(PARK_PATHS.infieldDirt, x)
    expect(dirt).not.toBeNull()
    expect(HIT_TARGETS.IF1B.y).toBeGreaterThan(dirt as number)
  })

  it.each(['1B', '2B'] as const)('clears the infield dirt on a %s', (key) => {
    // Regression: 1B originally sat at y=96, which is ON the dirt — a plain single
    // and an infield hit landed in the same region and stopped telling them apart.
    const dirt = curveYAt(PARK_PATHS.infieldDirt, HIT_TARGETS[key].x)
    expect(dirt).not.toBeNull()
    expect(deepest(key)).toBeLessThan(dirt as number)
  })

  it('drops a triple past the dirt entirely, down in the corner', () => {
    expect(curveYAt(PARK_PATHS.infieldDirt, HIT_TARGETS['3B'].x)).toBeNull()
  })

  it('puts a home run beyond the fence and everything else inside it', () => {
    const overFence = (key: keyof typeof HIT_TARGETS) => {
      const fence = curveYAt(PARK_PATHS.fence, HIT_TARGETS[key].x)
      return fence === null ? false : HIT_TARGETS[key].y < fence
    }
    expect(overFence('HR')).toBe(true)
    for (const key of ['3B', '2B', '1B', 'IF1B'] as const) expect(overFence(key)).toBe(false)
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
    const crest = cubicMidpoint(PARK_PATHS.infieldDirt, 1)
    expect(crest).toBeLessThan(spotPoint(FieldSpot.Second).y)
  })

  it('nests the dirt inside the warning track inside the fence', () => {
    const dirt = cubicMidpoint(PARK_PATHS.infieldDirt, 1)
    const track = cubicMidpoint(PARK_PATHS.warningTrack, 1)
    const fence = cubicMidpoint(PARK_PATHS.fence, 1)
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
