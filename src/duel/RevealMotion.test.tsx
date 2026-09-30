import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { OUTCOME_LADDER, type OutcomeKey } from '../components/ui/OutcomeLadder'
import { spotPoint } from './fieldMovement'
import { RevealMotion } from './RevealMotion'
import { frameToViewBox, TIGHT_FRAME } from './revealCamera'
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
    pitch: 500,
    swing: 400,
    pitcher: 'H. MARSH',
    batter: 'R. VANCE',
    clubs: { away: 'HAR', home: 'RID' },
    outcome: 'K',
    inning: 1,
    half: 'TOP',
    outs: 1,
    runsScored: 0,
    scoreBefore: { away: 0, home: 0 },
    hitsBefore: { away: 0, home: 0 },
    scoreline: 'R. VANCE strikes out',
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

describe('RevealMotion under reduced motion', () => {
  // ADR-0012 requires prefers-reduced-motion be respected in EVERY animated component.
  // Motion's own `reducedMotion="user"` only strips transforms and layout, and every
  // moving part of this reveal is an SVG attribute — viewBox, cx, cy, r, pathLength —
  // so each is gated by hand. Measured before the gate: the camera still ran its whole
  // sweep, the ball its whole flight, and runners circled the bases.
  const parkViewBox = (container: HTMLElement) =>
    [...container.querySelectorAll('svg[viewBox]')]
      .map((s) => s.getAttribute('viewBox') ?? '')
      .find((v) => Number(v.split(' ')[2]) > 200) ?? ''

  it('opens on the settled frame rather than panning out to it', () => {
    const { container } = render(
      <RevealMotion scenario={scenario({ outcome: 'HR', headline: 'HOME RUN!', movements: [] })} />,
    )
    const [, , width] = parkViewBox(container).split(' ').map(Number)
    // A ball over the fence earns the open frame; it must already be there.
    expect(width).toBeGreaterThan(TIGHT_FRAME.w)
  })

  it('stays tight when nothing was put in play — the frame is still a readout', () => {
    const { container } = render(
      <RevealMotion scenario={scenario({ outcome: 'K', movements: [] })} />,
    )
    expect(parkViewBox(container)).toBe(frameToViewBox(TIGHT_FRAME))
  })

  it('puts runners where the play left them, with no journey', () => {
    render(
      <RevealMotion
        scenario={scenario({
          outcome: '2B',
          headline: 'DOUBLE',
          movements: [{ from: FieldSpot.First, to: FieldSpot.Third, retired: false }],
        })}
      />,
    )
    const token = screen.getAllByTestId('runner-token')[0]
    const third = spotPoint(FieldSpot.Third)
    // Not first base, which is where the run would have started from.
    expect([token.getAttribute('cx'), token.getAttribute('cy')]).toEqual([
      String(third.x),
      String(third.y),
    ])
  })

  it('never puts a ball in flight', () => {
    render(
      <RevealMotion scenario={scenario({ outcome: '2B', headline: 'DOUBLE', movements: [] })} />,
    )
    expect(screen.queryByTestId('batted-ball')).toBeNull()
    // The outcome is still readable: the trail and the mark say where it went.
    expect(screen.queryByTestId('landing-hit')).not.toBeNull()
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
          scoreline: 'R. VANCE grounds out',
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
          scoreline: '4 runs score · R. VANCE goes yard',
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

describe('RevealMotion, read the same from either seat (SAN-39)', () => {
  /** One club's scoreboard cell as text: label, hits line, run total. */
  const clubCell = (label: string) =>
    screen.getByText(label).parentElement?.parentElement?.textContent ?? ''

  const homer = (half: 'TOP' | 'BOTTOM') =>
    scenario({
      outcome: 'HR',
      headline: 'HOME RUN!',
      half,
      runsScored: 1,
      scoreBefore: { away: 2, home: 5 },
      hitsBefore: { away: 3, home: 8 },
      movements: [{ from: FieldSpot.Batter, to: FieldSpot.Home, retired: false }],
    })

  it('labels the two numbers by what they are and who threw them, never "you"', () => {
    render(<RevealMotion scenario={scenario({ movements: [] })} />)
    // Each number's group reads label, number, player — the name sits under the
    // tile rather than beside the label, because "SWING · J. WHITLOCK" twice over
    // does not fit a phone's width on one line.
    const numberGroup = (label: string) =>
      screen.getByText(label).closest('[data-testid="duel-number"]')?.textContent
    expect(numberGroup('pitch')).toBe('pitch500H. MARSH')
    expect(numberGroup('swing')).toBe('swing400R. VANCE')
    expect(screen.queryByText(/^you$/i)).toBeNull()
  })

  it('shows the away club first and the home club second, by their labels', () => {
    render(<RevealMotion scenario={scenario({ movements: [] })} />)
    const away = screen.getByText('HAR')
    const home = screen.getByText('RID')
    expect(away.compareDocumentPosition(home) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.queryByText('YOU')).toBeNull()
  })

  it('credits a top-half run and hit to the away club, which was batting', () => {
    render(<RevealMotion scenario={homer('TOP')} />)
    expect(clubCell('HAR')).toBe('HAR4 HITS3runs')
    expect(clubCell('RID')).toBe('RID8 HITS5runs')
  })

  it('credits a bottom-half run and hit to the home club, which was batting', () => {
    render(<RevealMotion scenario={homer('BOTTOM')} />)
    expect(clubCell('HAR')).toBe('HAR3 HITS2runs')
    expect(clubCell('RID')).toBe('RID9 HITS6runs')
  })
})
