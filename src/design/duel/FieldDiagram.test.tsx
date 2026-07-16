import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { FieldDiagram } from './FieldDiagram'
import { FieldSpot } from './scenario'

afterEach(cleanup)

const tokens = () => screen.queryAllByTestId('runner-token')

describe('FieldDiagram live state (SAN-51)', () => {
  it('renders a bare, decorative diamond when no occupancy is given (reveal overlay use)', () => {
    render(<FieldDiagram />)
    expect(tokens()).toHaveLength(0)
    // Decorative: hidden from assistive tech, so it exposes no img role.
    expect(screen.queryByRole('img')).toBeNull()
  })

  it('renders one token per occupied spot — no phantom runners on an empty diamond', () => {
    render(<FieldDiagram runnersOn={[FieldSpot.Batter]} />)
    expect(tokens()).toHaveLength(1)
  })

  it('reads the batter as the hero color and on-base runners as clay (reveal parity)', () => {
    render(<FieldDiagram runnersOn={[FieldSpot.Second, FieldSpot.Batter]} />)
    const batter = tokens().find((t) => t.className.includes('bg-consequence'))
    const runner = tokens().find((t) => t.className.includes('bg-clay-bright'))
    expect(batter).toBeDefined()
    expect(runner).toBeDefined()
  })

  it('positions tokens by the shared field geometry, scaled to the box (percent)', () => {
    render(<FieldDiagram runnersOn={[FieldSpot.First]} />)
    const [runner] = tokens()
    // First base center is (205, 125) in the 240 viewBox → 85.4% / 52.1%.
    expect(runner.style.left).toBe('85.4%')
    expect(runner.style.top).toBe('52.1%')
  })

  it('describes the base state to assistive tech when it carries live occupancy', () => {
    render(<FieldDiagram runnersOn={[FieldSpot.Third, FieldSpot.First, FieldSpot.Batter]} />)
    // The label reads bases in on-field order regardless of the lead-order input.
    screen.getByRole('img', { name: 'Runners on 1st and 3rd' })
  })

  it('names the empty and loaded extremes', () => {
    render(<FieldDiagram runnersOn={[FieldSpot.Batter]} />)
    screen.getByRole('img', { name: 'Bases empty' })
    cleanup()
    render(
      <FieldDiagram
        runnersOn={[FieldSpot.Third, FieldSpot.Second, FieldSpot.First, FieldSpot.Batter]}
      />,
    )
    screen.getByRole('img', { name: 'Bases loaded' })
  })
})
