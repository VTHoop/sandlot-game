import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import DesignShowcase, { SHOWCASE_SCENARIO } from './DesignShowcase'

afterEach(cleanup)

const button = (name: string | RegExp) => screen.getByRole<HTMLButtonElement>('button', { name })

function lockNumber(value: string) {
  fireEvent.change(screen.getByLabelText(/your number/i), { target: { value } })
  fireEvent.click(button('LOCK IT IN'))
}

describe('DesignShowcase', () => {
  beforeEach(() => {
    render(<DesignShowcase />)
  })

  it('starts on the pitcher seat with the lock disabled until a valid number', () => {
    expect(button('LOCK IT IN').disabled).toBe(true)
    fireEvent.change(screen.getByLabelText(/your number/i), { target: { value: '472' } })
    expect(button('LOCK IT IN').disabled).toBe(false)
  })

  it('supports locking first on the pitcher seat (order-independent commits)', () => {
    screen.getByText('NOT YET ENTERED')
    lockNumber('472')
    expect(screen.getByRole('status').textContent).toContain('waiting on Maddie')
  })

  it('shows opponent presence in the chrome and outs in the scoreboard', () => {
    screen.getByRole('img', { name: 'Maddie is offline' })
    screen.getByRole('img', { name: '2 outs' })
    fireEvent.click(button('BATTER'))
    screen.getByRole('img', { name: 'Maddie is online' })
  })

  it("NEVER renders the opponent's number anywhere on the batter seat", () => {
    const secretText = String(SHOWCASE_SCENARIO.them)
    fireEvent.click(button('BATTER'))
    screen.getByText(/LOCKED/)
    expect(document.body.textContent).not.toContain(secretText)

    lockNumber('472')
    expect(document.body.textContent).not.toContain(secretText)
  })

  it('shows the player matchup with attributes and due-up hitters on both seats', () => {
    screen.getByText('A. PARKER')
    screen.getByText('C. DIAZ')
    screen.getByText('VEL')
    screen.getByText('J. WHITLOCK')
    fireEvent.click(button('BATTER'))
    screen.getByText('M. SLOANE')
    screen.getByText('T. JULIEN')
    screen.getByText('EYE')
    screen.getByText('R. VANCE')
  })

  it('moves from a locked swing into the reveal when both numbers are in', () => {
    fireEvent.click(button('BATTER'))
    lockNumber('472')
    fireEvent.click(button('PLAY THE REVEAL →'))
    expect(screen.getByRole('status').textContent).toBe('DOUBLE!')
  })

  it('shows both numbers, the outcome, and the situational callout on the reveal', () => {
    fireEvent.click(button('REVEAL'))
    screen.getByText(String(SHOWCASE_SCENARIO.you))
    screen.getByText(String(SHOWCASE_SCENARIO.them))
    screen.getByText('LEAD CHANGE — YOU LEAD 5–4')
    screen.getByText(SHOWCASE_SCENARIO.scoreline)
  })

  it('replaces the outcome ladder with a live scoreboard on the reveal', () => {
    fireEvent.click(button('REVEAL'))
    screen.getByText('MAD')
    screen.getByText('BOT 8TH')
    expect(screen.queryByText('GB')).toBeNull()
  })

  it('keeps the outcome ladder on the commit seats', () => {
    screen.getByText('GB')
    fireEvent.click(button('BATTER'))
    screen.getByText('GB')
  })

  it('shows the async waiting state with the scoreboard', () => {
    fireEvent.click(button('WAITING'))
    screen.getByText(/IT’S MADDIE’S TURN/)
    screen.getByText('MAD')
  })
})
