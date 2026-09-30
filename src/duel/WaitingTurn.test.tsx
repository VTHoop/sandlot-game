import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { SHOWCASE_SITUATION } from './fixture'
import { DuelSeat } from './seatAgent'
import { WaitingTurn } from './WaitingTurn'

afterEach(cleanup)

describe('WaitingTurn', () => {
  it('shows the live base state on the field while waiting (SAN-51)', () => {
    render(<WaitingTurn situation={SHOWCASE_SITUATION} waitingOn={DuelSeat.Pitcher} />)
    // The showcase situation has a runner on 2nd → that runner plus the batter,
    // and the field describes its occupancy to assistive tech.
    expect(screen.getAllByTestId('runner-token')).toHaveLength(2)
    screen.getByRole('img', { name: 'Runner on 2nd' })
  })

  it('names the player whose number is still out, for either seat (SAN-39)', () => {
    const { rerender } = render(
      <WaitingTurn situation={SHOWCASE_SITUATION} waitingOn={DuelSeat.Pitcher} />,
    )
    screen.getByText('WAITING ON M. SLOANE’S PITCH')

    rerender(<WaitingTurn situation={SHOWCASE_SITUATION} waitingOn={DuelSeat.Batter} />)
    screen.getByText('WAITING ON T. JULIEN’S SWING')
  })

  it('addresses nobody as "you" — the screen reads the same to either club', () => {
    render(<WaitingTurn situation={SHOWCASE_SITUATION} waitingOn={DuelSeat.Pitcher} />)
    expect(document.body.textContent).not.toMatch(/\byou\b|\byour\b/i)
    screen.getByText('HAR')
    screen.getByText('RID')
  })

  it('heads the screen with the matchup, away at home', () => {
    render(<WaitingTurn situation={SHOWCASE_SITUATION} waitingOn={DuelSeat.Pitcher} />)
    screen.getByText('HAR @ RID')
  })
})
