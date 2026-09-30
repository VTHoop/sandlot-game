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
    expect(screen.getByRole('status').textContent).toContain('waiting on T. JULIEN')
  })

  it('shows the matchup in the chrome and outs in the scoreboard', () => {
    // The chrome used to name "the opponent" and show a presence dot. There is no
    // presence data, and no single opponent once one account can own both clubs, so
    // it names the matchup instead (SAN-39).
    screen.getByText('HAR @ RID')
    screen.getByRole('img', { name: '2 outs' })
    fireEvent.click(button('BATTER'))
    screen.getByText('HAR @ RID')
  })

  it("NEVER renders the opponent's number anywhere on the batter seat", () => {
    const secretText = String(SHOWCASE_SCENARIO.pitch)
    fireEvent.click(button('BATTER'))
    screen.getByText(/LOCKED/)
    expect(document.body.textContent).not.toContain(secretText)

    lockNumber('472')
    expect(document.body.textContent).not.toContain(secretText)
  })

  it('shows the same player matchup, attributes and due-up hitters on both seats', () => {
    // One real matchup, seen from either seat — not a "you" side and an "opponent"
    // side with different players on each tab (SAN-39).
    const matchupIsShown = () => {
      screen.getByText('M. SLOANE')
      screen.getByText('T. JULIEN')
      screen.getByText('VEL')
      screen.getByText('EYE')
      screen.getByText('R. VANCE')
    }
    matchupIsShown()
    fireEvent.click(button('BATTER'))
    matchupIsShown()
  })

  it('moves from a locked swing into the reveal when both numbers are in', () => {
    fireEvent.click(button('BATTER'))
    lockNumber('472')
    fireEvent.click(button('PLAY THE REVEAL →'))
    expect(screen.getByRole('status').textContent).toBe('DOUBLE!')
  })

  it('shows both numbers, the outcome, and the situational callout on the reveal', () => {
    fireEvent.click(button('REVEAL'))
    screen.getByText(String(SHOWCASE_SCENARIO.pitch))
    screen.getByText(String(SHOWCASE_SCENARIO.swing))
    screen.getByText('LEAD CHANGE — RID LEADS 5–4')
    screen.getByText(SHOWCASE_SCENARIO.scoreline)
  })

  it('replaces the outcome ladder with a live scoreboard on the reveal', () => {
    fireEvent.click(button('REVEAL'))
    screen.getByText('HAR')
    screen.getByText('RID')
    screen.getByText('BOT 5TH')
    expect(screen.queryByText('GB')).toBeNull()
  })

  it('keeps the outcome ladder on the commit seats', () => {
    screen.getByText('GB')
    fireEvent.click(button('BATTER'))
    screen.getByText('GB')
  })

  it('shows the async waiting state with the scoreboard', () => {
    fireEvent.click(button('WAITING'))
    screen.getByText('WAITING ON M. SLOANE’S PITCH')
    screen.getByText('HAR')
  })
})
