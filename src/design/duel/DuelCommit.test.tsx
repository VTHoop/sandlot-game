import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DuelCommit } from './DuelCommit'
import { SHOWCASE_MATCHUP, SHOWCASE_SCENARIO, SHOWCASE_SITUATION } from './fixture'

afterEach(cleanup)

const numberInput = () => screen.getByLabelText<HTMLInputElement>(/your number/i)
const button = (name: string | RegExp) => screen.getByRole<HTMLButtonElement>('button', { name })

describe('DuelCommit', () => {
  it("NEVER renders the opponent's number, even once they have locked (secret-state law)", () => {
    const secret = String(SHOWCASE_SCENARIO.them)
    render(
      <DuelCommit
        seat="batter"
        matchup={SHOWCASE_MATCHUP}
        situation={SHOWCASE_SITUATION}
        opponentLocked
        opponentOnline
      />,
    )
    // The chip shows THAT the opponent locked — the number itself must never appear.
    screen.getByText(/LOCKED/)
    expect(document.body.textContent).not.toContain(secret)

    fireEvent.change(numberInput(), { target: { value: '472' } })
    fireEvent.click(button('LOCK IT IN'))
    expect(document.body.textContent).not.toContain(secret)
  })

  it('surfaces the committed number to the parent when the seat locks', () => {
    const onLock = vi.fn()
    render(
      <DuelCommit
        seat="pitcher"
        matchup={SHOWCASE_MATCHUP}
        situation={SHOWCASE_SITUATION}
        opponentLocked={false}
        opponentOnline={false}
        onLock={onLock}
      />,
    )
    fireEvent.change(numberInput(), { target: { value: '472' } })
    fireEvent.click(button('LOCK IT IN'))
    expect(onLock).toHaveBeenCalledExactlyOnceWith(472)
  })

  it('shows the live base state on the field: the batter plus each occupied base (SAN-51)', () => {
    render(
      <DuelCommit
        seat="batter"
        matchup={SHOWCASE_MATCHUP}
        situation={SHOWCASE_SITUATION}
        opponentLocked={false}
        opponentOnline
      />,
    )
    // The showcase situation has a runner on 2nd → that runner plus the batter,
    // never the old decorative lone-runner default.
    expect(screen.getAllByTestId('runner-token')).toHaveLength(2)
    screen.getByRole('img', { name: 'Runner on 2nd' })
  })

  it('does not surface a number while it is still invalid', () => {
    const onLock = vi.fn()
    render(
      <DuelCommit
        seat="pitcher"
        matchup={SHOWCASE_MATCHUP}
        situation={SHOWCASE_SITUATION}
        opponentLocked={false}
        opponentOnline={false}
        onLock={onLock}
      />,
    )
    // The lock stays disabled until the entry is a valid duel number, so the
    // parent is never handed a bad commit.
    expect(button('LOCK IT IN').disabled).toBe(true)
    expect(onLock).not.toHaveBeenCalled()
  })
})
