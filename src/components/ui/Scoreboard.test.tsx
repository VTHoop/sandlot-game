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

  it('does not tick on first render, then ticks when a value changes', () => {
    const { rerender } = render(<Scoreboard {...fixture} />)
    expect(document.querySelector('.motif-tick')).toBeNull()

    rerender(<Scoreboard {...fixture} home={{ label: 'YOU', runs: 5, hits: 7 }} />)
    const ticked = document.querySelector('.motif-tick')
    expect(ticked?.textContent).toBe('5')
  })
})
