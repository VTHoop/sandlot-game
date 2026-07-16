import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { Scoreboard } from './Scoreboard'

afterEach(cleanup)

const fixture = {
  away: { label: 'MAD', runs: 4, hits: 6 },
  home: { label: 'YOU', runs: 4, hits: 7 },
  inning: 'BOT 8TH',
}

describe('Scoreboard', () => {
  it('renders both team lines and the inning', () => {
    render(<Scoreboard {...fixture} />)
    screen.getByText('MAD')
    screen.getByText('YOU')
    screen.getByText('BOT 8TH')
    screen.getByText('7')
  })

  it('shows outs as three pips — filled per recorded out, described to assistive tech (SAN-51)', () => {
    render(<Scoreboard {...fixture} outs={2} />)
    // The old 9px "2 OUT" text was the least visible element on the screen;
    // outs are decision-critical, so they read as pips (shape beats tiny text).
    expect(screen.queryByText(/OUT/)).toBeNull()
    screen.getByRole('img', { name: '2 outs' })
    const pips = screen.getAllByTestId('out-pip')
    expect(pips).toHaveLength(3)
    expect(pips.filter((pip) => pip.className.includes('bg-chalk'))).toHaveLength(2)
  })

  it('pluralizes the outs label correctly at one out', () => {
    render(<Scoreboard {...fixture} outs={1} />)
    screen.getByRole('img', { name: '1 out' })
  })

  it('renders no pips when outs is not supplied', () => {
    render(<Scoreboard {...fixture} />)
    expect(screen.queryAllByTestId('out-pip')).toHaveLength(0)
  })

  it('does not tick on first render, then ticks when a value changes', () => {
    const { rerender } = render(<Scoreboard {...fixture} />)
    expect(document.querySelector('.motif-tick')).toBeNull()

    rerender(<Scoreboard {...fixture} home={{ label: 'YOU', runs: 5, hits: 7 }} />)
    const ticked = document.querySelector('.motif-tick')
    expect(ticked?.textContent).toBe('5')
  })
})
