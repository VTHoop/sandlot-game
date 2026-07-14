import type { GameContext } from '@sandlot/engine/game'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { DuelPlay } from './DuelPlay'
import type { Roster } from './roster'

// Reduce motion so RevealMotion settles synchronously (no pending timers/act warnings).
beforeAll(() => {
  window.matchMedia = ((query: string) => ({
    matches: true,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia
})

afterEach(cleanup)

// A leadoff-grade hitter versus the H. MARSH arm block: pitch 500 / swing 113 is
// the exact pair the adapter suite probes to a strikeout (diff 387 → K), so three
// of them end the half deterministically. One batter per side keeps it wrapping
// onto the same matchup each time.
const PITCH = 500
const K_SWING = 113
const roster: Roster = new Map([
  ['a1', { name: 'LEADOFF', attributes: { power: 3, contact: 3, speed: 3, eye: 5 }, speed: 3 }],
  ['h1', { name: 'HOMER', attributes: { power: 3, contact: 3, speed: 3, eye: 5 }, speed: 3 }],
  [
    'ap',
    {
      name: 'AWAYARM',
      attributes: { velocity: 3, movement: 3, awareness: 3, command: 3 },
      speed: 1,
    },
  ],
  [
    'hp',
    {
      name: 'H. MARSH',
      attributes: { velocity: 3, movement: 3, awareness: 3, command: 1 },
      speed: 1,
    },
  ],
])
const context: GameContext = {
  away: { battingOrder: ['a1'], pitcher: 'ap' },
  home: { battingOrder: ['h1'], pitcher: 'hp' },
}

const numberInput = () => screen.getByLabelText<HTMLInputElement>(/your number/i)
const lockButton = () => screen.getByRole<HTMLButtonElement>('button', { name: 'LOCK IT IN' })

async function commitPitch(value: number) {
  fireEvent.change(await screen.findByLabelText(/your number/i), {
    target: { value: String(value) },
  })
  fireEvent.click(lockButton())
}

async function commitSwing(value: number) {
  // The batter seat is up once the opponent chip flips to locked.
  await screen.findByText('🔒 LOCKED')
  fireEvent.change(numberInput(), { target: { value: String(value) } })
  fireEvent.click(lockButton())
}

async function advancePastReveal() {
  await screen.findByRole('button', { name: '↺ REPLAY' })
  fireEvent.click(screen.getByRole('button', { name: /(NEXT BATTER|END OF HALF) →/ }))
}

describe('DuelPlay', () => {
  it('never shows the batter seat the pitch after the pitcher commits (secret-state law)', async () => {
    render(<DuelPlay roster={roster} context={context} />)

    // Pitcher seat is up first: the opponent (batter) has not committed yet.
    await screen.findByLabelText(/your number/i)
    expect(screen.getByText('NOT YET ENTERED')).toBeTruthy()

    await commitPitch(PITCH)

    // The batter seat is now on the clock and knows only THAT the pitch is locked.
    await screen.findByText('🔒 LOCKED')
    expect(document.body.textContent).not.toContain(String(PITCH))
  })

  it('sequences a full half-inning from live state to the end-of-half summary', async () => {
    render(<DuelPlay roster={roster} context={context} />)

    for (let out = 0; out < 3; out += 1) {
      await commitPitch(PITCH)
      await commitSwing(K_SWING)
      if (out === 0) {
        // The reveal can be replayed without advancing the at-bat.
        await screen.findByRole('button', { name: '↺ REPLAY' })
        fireEvent.click(screen.getByRole('button', { name: '↺ REPLAY' }))
      }
      await advancePastReveal()
    }

    await screen.findByText('END OF HALF')
    // One batter, struck out thrice: no runs, no hits.
    expect(screen.getByText('RUNS')).toBeTruthy()
    expect(screen.getByText('HITS')).toBeTruthy()
    const values = screen.getAllByText('0')
    expect(values.length).toBeGreaterThanOrEqual(2)
  })

  it('restarts a fresh half-inning from the end-of-half summary', async () => {
    render(<DuelPlay roster={roster} context={context} />)

    for (let out = 0; out < 3; out += 1) {
      await commitPitch(PITCH)
      await commitSwing(K_SWING)
      await advancePastReveal()
    }

    fireEvent.click(await screen.findByRole('button', { name: 'PLAY AGAIN' }))

    // Back to the top of the half: the pitcher seat is on the clock with a fresh entry.
    const input = await screen.findByLabelText<HTMLInputElement>(/your number/i)
    expect(input.value).toBe('')
    expect(screen.queryByText('END OF HALF')).toBeNull()
  })

  it('sets a seat to bot so the human never fills it (human-vs-bot)', async () => {
    render(<DuelPlay roster={roster} context={context} />)

    // Default hotseat: the pitcher seat is up first.
    await screen.findByLabelText(/your number/i)

    // Hand the pitcher seat to a bot; the half re-seeds.
    fireEvent.click(screen.getByRole('button', { name: /set pitcher to bot/i }))

    // The human is only ever the batter now: the pitch is already locked (supplied
    // by the bot) and the human is never asked to enter one.
    await screen.findByText('🔒 LOCKED')
    expect(numberInput()).toBeTruthy()
  })

  it('plays a bot-vs-bot half-inning to completion with no human input', async () => {
    render(<DuelPlay roster={roster} context={context} />)
    await screen.findByLabelText(/your number/i)

    // Set BOTH seats to bot; the half then runs itself to the summary.
    fireEvent.click(screen.getByRole('button', { name: /set pitcher to bot/i }))
    fireEvent.click(screen.getByRole('button', { name: /set batter to bot/i }))

    await screen.findByText('END OF HALF')
    // No commit screen was ever shown for the bot-vs-bot half.
    expect(screen.queryByLabelText(/your number/i)).toBeNull()
  })

  it('plays a human-vs-bot half-inning through to the end-of-half summary', async () => {
    render(<DuelPlay roster={roster} context={context} />)
    await screen.findByLabelText(/your number/i)

    // Bot pitches, human bats. The bot's pitch is random, so outcomes (and thus the
    // number of at-bats to three outs) vary — drive the human batter until the reveal
    // reports the half ended, rather than assuming a fixed count.
    fireEvent.click(screen.getByRole('button', { name: /set pitcher to bot/i }))

    for (let guard = 0; guard < 100; guard += 1) {
      // Only the human batter ever commits — the bot pitch is already locked.
      await commitSwing(K_SWING)
      await screen.findByRole('button', { name: '↺ REPLAY' })
      // The advance label tells us whether this at-bat's third out ended the half.
      const advance = screen.getByRole('button', { name: /(NEXT BATTER|END OF HALF) →/ })
      const endsHalf = /END OF HALF/.test(advance.textContent ?? '')
      fireEvent.click(advance)
      if (endsHalf) break
    }

    await screen.findByText('END OF HALF')
  })

  it('surfaces a loop failure instead of freezing on the last view', async () => {
    // The home pitcher id is absent from the roster, so the loop's first
    // situation derivation throws — the container must report it, not hang.
    const broken: GameContext = {
      away: { battingOrder: ['a1'], pitcher: 'ap' },
      home: { battingOrder: ['h1'], pitcher: 'no-such-pitcher' },
    }
    render(<DuelPlay roster={roster} context={broken} />)

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toMatch(/pitcher/i)
    expect(screen.getByRole('button', { name: 'PLAY AGAIN' })).toBeTruthy()
  })
})
