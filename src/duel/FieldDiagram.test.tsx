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

describe('FieldDiagram runner identity (SAN-39)', () => {
  it('names each runner in the description when it is told who they are', () => {
    render(
      <FieldDiagram
        runnersOn={[FieldSpot.Batter, FieldSpot.Second]}
        runners={[{ spot: FieldSpot.Second, name: 'T. JULIEN' }]}
      />,
    )
    screen.getByRole('img', { name: 'T. JULIEN on 2nd' })
  })

  it('names every runner in on-field reading order, first to third', () => {
    render(
      <FieldDiagram
        runnersOn={[FieldSpot.Batter, FieldSpot.Third, FieldSpot.First]}
        runners={[
          { spot: FieldSpot.Third, name: 'C. DIAZ' },
          { spot: FieldSpot.First, name: 'S. ORTIZ' },
        ]}
      />,
    )
    screen.getByRole('img', { name: 'S. ORTIZ on 1st and C. DIAZ on 3rd' })
  })

  it('still says "Bases empty" when nobody is on', () => {
    render(<FieldDiagram runnersOn={[FieldSpot.Batter]} runners={[]} />)
    screen.getByRole('img', { name: 'Bases empty' })
  })
})
