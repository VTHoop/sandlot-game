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

describe('RevealMotion field', () => {
  it('renders one token per real movement — a strikeout has no phantom runners', () => {
    render(
      <RevealMotion
        scenario={scenario({
          outcome: 'K',
          movements: [{ from: FieldSpot.Batter, to: FieldSpot.Out }],
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
            { from: FieldSpot.First, to: FieldSpot.Out },
            { from: FieldSpot.Batter, to: FieldSpot.Out },
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
            { from: FieldSpot.Third, to: FieldSpot.Home },
            { from: FieldSpot.Second, to: FieldSpot.Home },
            { from: FieldSpot.First, to: FieldSpot.Home },
            { from: FieldSpot.Batter, to: FieldSpot.Home },
          ],
        })}
      />,
    )
    expect(screen.getAllByTestId('runner-token')).toHaveLength(4)
  })
})
