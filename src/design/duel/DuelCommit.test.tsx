import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DuelCommit } from './DuelCommit'
import { SHOWCASE_MATCHUP, SHOWCASE_SITUATION } from './fixture'

afterEach(cleanup)

const numberInput = () => screen.getByLabelText<HTMLInputElement>(/your number/i)
const button = (name: string | RegExp) => screen.getByRole<HTMLButtonElement>('button', { name })

describe('DuelCommit', () => {
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
