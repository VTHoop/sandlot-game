import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { OUTCOME_LADDER, type OutcomeKey } from '../../components/ui/OutcomeLadder'
import { RevealMotion } from './RevealMotion'
import { FieldSpot, type RevealScenario, type RunnerMovement } from './scenario'

// Reduce motion so the reveal settles synchronously (no pending timers/act warnings).
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

function scenario(
  overrides: Partial<RevealScenario> & { movements: RunnerMovement[] },
): RevealScenario {
  return {
    you: 400,
    them: 500,
    opponent: 'ARM',
    outcome: 'K',
    inning: 1,
    half: 'TOP',
    outs: 1,
    runsScored: 0,
    scoreBefore: { you: 0, opp: 0 },
    hitsBefore: { you: 0, opp: 0 },
    scoreline: 'you strike out',
    headline: 'STRIKEOUT',
    ...overrides,
  }
}

describe('RevealMotion landing mark', () => {
  // The scorer's own convention: a hit is a dot where the ball landed, an out is an
  // X. Shape carries it, not colour, so it survives greyscale and does not spend the
  // amber ADR-0012 reserves for consequence.
  const mark = () => ({
    hit: screen.queryByTestId('landing-hit'),
    out: screen.queryByTestId('landing-out'),
  })

  // Every outcome and the mark it must leave. The cases differ only in data, so the
  // data is the test — four near-identical blocks said the same thing four times and
  // let a new outcome be added without anyone noticing it was never marked.
  const LANDING_CASES: ReadonlyArray<{
    outcome: OutcomeKey
    headline: string
    leaves: 'hit' | 'out' | 'nothing'
    why: string
  }> = [
    { outcome: '3B', headline: 'HIT', leaves: 'hit', why: 'a dot down in the corner' },
    { outcome: '2B', headline: 'HIT', leaves: 'hit', why: 'a dot where the ball landed' },
    { outcome: '1B', headline: 'HIT', leaves: 'hit', why: 'a dot where the ball landed' },
    { outcome: 'IF1B', headline: 'HIT', leaves: 'hit', why: 'a dot even on the dirt' },
    { outcome: 'GB', headline: 'OUT', leaves: 'out', why: 'an X, the scorer’s out' },
    { outcome: 'FO', headline: 'OUT', leaves: 'out', why: 'an X, the scorer’s out' },
    { outcome: 'PO', headline: 'OUT', leaves: 'out', why: 'an X, the scorer’s out' },
    { outcome: 'HR', headline: 'HOME RUN!', leaves: 'nothing', why: 'nothing — it left the park' },
    { outcome: 'K', headline: 'NO CONTACT', leaves: 'nothing', why: 'nothing — never in play' },
    { outcome: 'BB', headline: 'NO CONTACT', leaves: 'nothing', why: 'nothing — never in play' },
  ]

  it.each(LANDING_CASES)('$outcome leaves $why', ({ outcome, headline, leaves }) => {
    render(
      <RevealMotion
        scenario={scenario({ outcome, headline, movements: [] })}
        onReplay={() => {}}
      />,
    )
    const { hit, out } = mark()
    // Asserted as a pair, so a play that somehow drew BOTH marks still fails.
    expect({ hit: hit !== null, out: out !== null }).toEqual({
      hit: leaves === 'hit',
      out: leaves === 'out',
    })
  })

  it('covers every outcome on the ladder, so a new one cannot slip in unmarked', () => {
    expect(LANDING_CASES.map((c) => c.outcome).sort()).toEqual([...OUTCOME_LADDER].sort())
  })
})

describe('RevealMotion field', () => {
  it('renders one token per real movement — a strikeout has no phantom runners', () => {
    render(
      <RevealMotion
        scenario={scenario({
          outcome: 'K',
          movements: [{ from: FieldSpot.Batter, to: FieldSpot.Batter, retired: true }],
        })}
      />,
    )
    // The bug: two canned runners circled the bases on EVERY play. The field now
    // shows exactly the runners the play produced — here, just the retired batter.
    expect(screen.getAllByTestId('runner-token')).toHaveLength(1)
  })

  it('shouts the specific headline, not the generic band — a double play', () => {
    render(
      <RevealMotion
        scenario={scenario({
          outcome: 'GB',
          outs: 3,
          scoreline: 'you ground out',
          headline: 'DOUBLE PLAY',
          movements: [
            { from: FieldSpot.First, to: FieldSpot.Second, retired: true },
            { from: FieldSpot.Batter, to: FieldSpot.First, retired: true },
          ],
        })}
      />,
    )
    // Assert on the headline element itself (role=status), not just any matching
    // text, so this pins what the callout shows. jest-dom's toHaveTextContent isn't
    // wired up here, so read textContent directly.
    expect(screen.getByRole('status').textContent).toBe('DOUBLE PLAY')
    expect(screen.queryByText('GROUNDOUT')).toBeNull()
  })

  it('renders a token for every scorer on a grand slam', () => {
    render(
      <RevealMotion
        scenario={scenario({
          outcome: 'HR',
          runsScored: 4,
          scoreline: '4 runs score · you go yard',
          movements: [
            { from: FieldSpot.Third, to: FieldSpot.Home, retired: false },
            { from: FieldSpot.Second, to: FieldSpot.Home, retired: false },
            { from: FieldSpot.First, to: FieldSpot.Home, retired: false },
            { from: FieldSpot.Batter, to: FieldSpot.Home, retired: false },
          ],
        })}
      />,
    )
    expect(screen.getAllByTestId('runner-token')).toHaveLength(4)
  })
})
