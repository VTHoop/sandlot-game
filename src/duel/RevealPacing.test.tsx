import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { RevealMotion } from './RevealMotion'
import { revealBeats } from './revealTiming'
import { FieldSpot, type RevealScenario } from './scenario'

// Full motion: this file is about WHEN things land, which reduced motion collapses.
// It lives apart from RevealMotion.test.tsx because Motion reads the preference once
// per module load, so one file cannot hold both.
beforeAll(() => {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia
})

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

/** A strikeout with one out already on the board: it records the second. */
const STRIKEOUT: RevealScenario = {
  pitch: 500,
  swing: 400,
  pitcher: 'H. MARSH',
  batter: 'R. VANCE',
  clubs: { away: 'HAR', home: 'RID' },
  outcome: 'K',
  inning: 3,
  half: 'TOP',
  outsBefore: 1,
  outs: 2,
  runsScored: 0,
  scoreBefore: { away: 1, home: 1 },
  hitsBefore: { away: 2, home: 3 },
  scoreline: 'R. VANCE strikes out',
  headline: 'STRIKEOUT',
  movements: [{ from: FieldSpot.Batter, to: FieldSpot.Batter, retired: true }],
}

const beats = revealBeats(STRIKEOUT)
const JUST_BEFORE = 0.05

/** Move the reveal's clock to `seconds` after it opened. */
function playTo(seconds: number, from = 0) {
  act(() => {
    vi.advanceTimersByTime((seconds - from) * 1000)
  })
}

const outsShown = () => screen.getByRole('img', { name: /\bouts?$/ }).getAttribute('aria-label')
const advance = () => screen.queryByRole('button', { name: 'NEXT BATTER →' })
const replay = () => screen.queryByRole('button', { name: '↺ REPLAY' })

/** The reveal the way both of its callers mount it: REPLAY remounts it from the top. */
function Replayable({ scenario }: { scenario: RevealScenario }) {
  const [replayKey, setReplayKey] = useState(0)
  return (
    <RevealMotion
      key={replayKey}
      scenario={scenario}
      onReplay={() => {
        setReplayKey((k) => k + 1)
      }}
      onAdvance={() => {}}
      advanceLabel="NEXT BATTER →"
    />
  )
}

describe('RevealMotion pacing — nothing is given away before the outcome (SAN-70)', () => {
  it('shows the out count as it stood before the play until the outcome lands', () => {
    render(<Replayable scenario={STRIKEOUT} />)
    expect(outsShown()).toBe('1 out')
    playTo(beats.outcomeAt - JUST_BEFORE)
    expect(outsShown()).toBe('1 out')
  })

  it('records the out when the hit would count — once the outcome has landed', () => {
    render(<Replayable scenario={STRIKEOUT} />)
    playTo(beats.hitTickAt + JUST_BEFORE)
    expect(outsShown()).toBe('2 outs')
  })

  it('holds back both controls until the outcome lands', () => {
    render(<Replayable scenario={STRIKEOUT} />)
    expect(advance()).toBeNull()
    expect(replay()).toBeNull()
    playTo(beats.outcomeAt - JUST_BEFORE)
    expect(advance()).toBeNull()
    expect(replay()).toBeNull()
    playTo(beats.outcomeAt + JUST_BEFORE, beats.outcomeAt - JUST_BEFORE)
    expect(advance()).not.toBeNull()
    expect(replay()).not.toBeNull()
  })

  it('puts the pre-play board back on REPLAY and counts it again', () => {
    render(<Replayable scenario={STRIKEOUT} />)
    playTo(beats.scorelineAt + 1)
    expect(outsShown()).toBe('2 outs')

    fireEvent.click(screen.getByRole('button', { name: '↺ REPLAY' }))
    expect(outsShown()).toBe('1 out')
    expect(advance()).toBeNull()

    playTo(beats.scorelineAt + 1)
    expect(outsShown()).toBe('2 outs')
    expect(advance()).not.toBeNull()
  })
})
