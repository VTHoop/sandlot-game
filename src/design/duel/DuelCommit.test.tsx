import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DuelCommit } from './DuelCommit'
import { SHOWCASE_MATCHUP, SHOWCASE_SCENARIO, SHOWCASE_SITUATION } from './fixture'
import { DuelSeat } from './seatAgent'

afterEach(cleanup)

const numberInput = () => screen.getByLabelText<HTMLInputElement>(/your number/i)
const button = (name: string | RegExp) => screen.getByRole<HTMLButtonElement>('button', { name })

describe('DuelCommit', () => {
  it("NEVER renders the opponent's number, even once they have locked (secret-state law)", () => {
    const secret = String(SHOWCASE_SCENARIO.pitch)
    render(
      <DuelCommit
        seat={DuelSeat.Batter}
        matchup={SHOWCASE_MATCHUP}
        situation={SHOWCASE_SITUATION}
        opponentLocked
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
        seat={DuelSeat.Pitcher}
        matchup={SHOWCASE_MATCHUP}
        situation={SHOWCASE_SITUATION}
        opponentLocked={false}
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
        seat={DuelSeat.Batter}
        matchup={SHOWCASE_MATCHUP}
        situation={SHOWCASE_SITUATION}
        opponentLocked={false}
      />,
    )
    // The showcase situation has a runner on 2nd → that runner plus the batter,
    // never the old decorative lone-runner default.
    expect(screen.getAllByTestId('runner-token')).toHaveLength(2)
    screen.getByRole('img', { name: 'Runner on 2nd' })
  })

  it('pressing Enter with a valid number locks the seat', () => {
    const onLock = vi.fn()
    render(
      <DuelCommit
        seat={DuelSeat.Pitcher}
        matchup={SHOWCASE_MATCHUP}
        situation={SHOWCASE_SITUATION}
        opponentLocked={false}
        onLock={onLock}
      />,
    )
    fireEvent.change(numberInput(), { target: { value: '472' } })
    fireEvent.keyDown(numberInput(), { key: 'Enter' })
    expect(onLock).toHaveBeenCalledExactlyOnceWith(472)
  })

  it('pressing Enter with an invalid entry is a no-op', () => {
    const onLock = vi.fn()
    render(
      <DuelCommit
        seat={DuelSeat.Pitcher}
        matchup={SHOWCASE_MATCHUP}
        situation={SHOWCASE_SITUATION}
        opponentLocked={false}
        onLock={onLock}
      />,
    )
    fireEvent.keyDown(numberInput(), { key: 'Enter' })
    expect(onLock).not.toHaveBeenCalled()
  })

  it('does not surface a number while it is still invalid', () => {
    const onLock = vi.fn()
    render(
      <DuelCommit
        seat={DuelSeat.Pitcher}
        matchup={SHOWCASE_MATCHUP}
        situation={SHOWCASE_SITUATION}
        opponentLocked={false}
        onLock={onLock}
      />,
    )
    // The lock stays disabled until the entry is a valid duel number, so the
    // parent is never handed a bad commit.
    expect(button('LOCK IT IN').disabled).toBe(true)
    expect(onLock).not.toHaveBeenCalled()
  })

  describe('read the same from either seat (SAN-39)', () => {
    const commitScreen = (seat: DuelSeat, opponentLocked = false) =>
      render(
        <DuelCommit
          seat={seat}
          matchup={SHOWCASE_MATCHUP}
          situation={SHOWCASE_SITUATION}
          opponentLocked={opponentLocked}
        />,
      )

    it('names the other seat’s player on the lock chip — the batter waits on the pitch', () => {
      commitScreen(DuelSeat.Batter, true)
      screen.getByText('M. SLOANE’s pitch')
      screen.getByText('🔒 LOCKED')
    })

    it('names the other seat’s player on the lock chip — the pitcher waits on the swing', () => {
      commitScreen(DuelSeat.Pitcher)
      screen.getByText('T. JULIEN’s swing')
      screen.getByText('NOT YET ENTERED')
    })

    it('shows the real half to the pitcher seat, not a fixed TOP', () => {
      // The showcase at-bat is in the BOTTOM half. The pitcher's screen used to say
      // TOP regardless — right for a fixture that cast the viewer as the home club,
      // wrong the moment the state is a real game's.
      commitScreen(DuelSeat.Pitcher)
      screen.getByText('BOT 5TH')
      expect(screen.queryByText(/^TOP/)).toBeNull()
    })

    it.each([
      DuelSeat.Pitcher,
      DuelSeat.Batter,
    ])('shows the %s seat the same scoreboard and header: away then home, by club', (seat) => {
      commitScreen(seat)
      const away = screen.getByText('HAR')
      const home = screen.getByText('RID')
      expect(away.compareDocumentPosition(home) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
      expect(screen.queryByText('YOU')).toBeNull()
      screen.getByText('HAR @ RID')
    })

    it('shows both seats the one real matchup', () => {
      const { unmount } = commitScreen(DuelSeat.Pitcher)
      screen.getByText('M. SLOANE')
      screen.getByText('T. JULIEN')
      unmount()
      commitScreen(DuelSeat.Batter)
      screen.getByText('M. SLOANE')
      screen.getByText('T. JULIEN')
    })

    it('says who it is waiting on once this seat has locked', () => {
      commitScreen(DuelSeat.Pitcher)
      fireEvent.change(numberInput(), { target: { value: '472' } })
      fireEvent.click(button('LOCK IT IN'))
      expect(screen.getByRole('status').textContent).toContain('waiting on T. JULIEN')
    })
  })
})
