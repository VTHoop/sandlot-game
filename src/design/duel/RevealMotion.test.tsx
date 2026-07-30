import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
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

  it.each(['2B', '1B', 'IF1B'] as const)('marks a %s with the hit dot', (outcome) => {
    render(
      <RevealMotion
        scenario={scenario({ outcome, headline: 'HIT', movements: [] })}
        onReplay={() => {}}
      />,
    )
    expect(mark().hit).not.toBeNull()
    expect(mark().out).toBeNull()
  })

  it.each(['GB', 'FO', 'PO'] as const)('marks a %s with the out X', (outcome) => {
    render(
      <RevealMotion
        scenario={scenario({ outcome, headline: 'OUT', movements: [] })}
        onReplay={() => {}}
      />,
    )
    expect(mark().out).not.toBeNull()
    expect(mark().hit).toBeNull()
  })

  it('marks a home run with neither — it left the park', () => {
    render(
      <RevealMotion
        scenario={scenario({ outcome: 'HR', headline: 'HOME RUN!', movements: [] })}
        onReplay={() => {}}
      />,
    )
    expect(mark().hit).toBeNull()
    expect(mark().out).toBeNull()
  })

  it.each(['K', 'BB'] as const)('marks nothing on a %s — no ball was put in play', (outcome) => {
    render(
      <RevealMotion
        scenario={scenario({ outcome, headline: 'NO CONTACT', movements: [] })}
        onReplay={() => {}}
      />,
    )
    expect(mark().hit).toBeNull()
    expect(mark().out).toBeNull()
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
