import { GameStatus, Half } from '@sandlot/engine/game'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Id } from '../../convex/_generated/dataModel'
import type { GameListEntry } from '../../convex/myGames'
import App from '../App'
import { owns } from '../duel/testing/liveViews'

/**
 * The signed-in landing screen's game list (SAN-72), tested through `<App />` at
 * `/`. The list subscription is a controllable fake: a test plays the server,
 * reporting rows (already in the server's order), nothing yet, or a failure,
 * and re-renders to push an update down the subscription.
 */
const sdk = vi.hoisted(() => ({
  signedIn: true,
  listMyGames: vi.fn<(args: unknown) => GameListEntry[] | undefined>(),
}))

vi.mock('@clerk/react', () => ({
  useAuth: () => ({ isLoaded: true, isSignedIn: sdk.signedIn }),
  SignIn: () => <div data-testid="clerk-sign-in" />,
  UserButton: () => <div data-testid="clerk-user-button" />,
}))

vi.mock('convex/react', async () => {
  const { getFunctionName } = await import('convex/server')
  type Ref = Parameters<typeof getFunctionName>[0]
  return {
    useConvexAuth: () => ({ isLoading: false, isAuthenticated: sdk.signedIn }),
    useMutation: () => () => Promise.resolve('users-row-id'),
    useQuery: (ref: Ref, args: unknown) => {
      const name = getFunctionName(ref)
      if (name !== 'myGames:listMyGames') throw new Error(`the landing screen reached for ${name}`)
      return sdk.listMyGames(args)
    },
  }
})

beforeEach(() => {
  sdk.signedIn = true
  sdk.listMyGames.mockReset().mockReturnValue(undefined)
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  window.history.pushState({}, '', '/')
})

const gameId = (n: number) => `game-${n}` as Id<'games'>

/** The two clubs every row here is between, each with the display name of the
 * human who holds it. */
const CLUBS = {
  home: { id: 'home-club' as Id<'teams'>, name: 'Ridgeview Rail', manager: 'rail-skipper' },
  away: { id: 'away-club' as Id<'teams'>, name: 'Harbor Kingfishers', manager: 'kingfisher-kid' },
}

/** Rows as the HOME owner of Ridgeview Rail reads them, unless `viewerOwns` says otherwise. */
const scheduled = (n: number, viewerOwns = owns(true, false)): GameListEntry => ({
  id: gameId(n),
  status: GameStatus.Scheduled,
  ...CLUBS,
  viewerOwns,
})

const live = (
  n: number,
  overrides: Partial<Extract<GameListEntry, { status: GameStatus.Live }>> = {},
): GameListEntry => ({
  id: gameId(n),
  status: GameStatus.Live,
  ...CLUBS,
  viewerOwns: owns(true, false),
  inning: 3,
  half: Half.Top,
  score: { home: 2, away: 1 },
  yourMove: true,
  ...overrides,
})

const final = (n: number): GameListEntry => ({
  id: gameId(n),
  status: GameStatus.Final,
  ...CLUBS,
  viewerOwns: owns(true, false),
  score: { home: 3, away: 4 },
})

/** Open `/` with the server reporting `rows`; returns a way to push an update. */
async function openLanding(rows: GameListEntry[] | undefined) {
  sdk.listMyGames.mockReturnValue(rows)
  const view = render(<App />)
  // The provisioning gate resolves on a microtask; let the route mount.
  await screen.findByTestId('clerk-user-button')
  return {
    serverReports: (next: GameListEntry[]) => {
      sdk.listMyGames.mockReturnValue(next)
      view.rerender(<App />)
    },
  }
}

const gameLinks = () =>
  within(screen.getByRole('list', { name: /your games/i })).getAllByRole('link')
const text = (element: HTMLElement) => element.textContent ?? ''

/** Each of `lines` is its own element in `row`, in this order. Pairs are walked
 * with `reduce` rather than by index — no computed member access (AGENTS.md). */
function expectInOrder(row: HTMLElement, lines: string[]) {
  lines
    .map((line) => within(row).getByText(line))
    .reduce((earlier, later) => {
      expect(earlier.compareDocumentPosition(later) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
      return later
    })
}

describe('Landing — the game list', () => {
  it('lists the games in the order the server reports, each opening its game', async () => {
    await openLanding([live(1), scheduled(2), final(3)])

    const links = gameLinks()
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      '/game/game-1',
      '/game/game-2',
      '/game/game-3',
    ])
  })

  it('leads with the viewer’s club, then “vs.” the opponent’s club and, in parentheses, who holds it', async () => {
    await openLanding([scheduled(1)])

    const [row] = gameLinks()
    expectInOrder(row, ['Ridgeview Rail', 'vs. Harbor Kingfishers', '(kingfisher-kid)'])
    expect(text(row)).not.toContain('rail-skipper')
  })

  it('names both clubs, and no opponent, when the viewer holds both', async () => {
    await openLanding([scheduled(1, owns(true, true))])

    const [row] = gameLinks()
    expect(text(row)).toContain('Harbor Kingfishers')
    expect(text(row)).toContain('Ridgeview Rail')
    expect(text(row)).not.toContain('rail-skipper')
    expect(text(row)).not.toContain('kingfisher-kid')
  })

  it('leads with the away club, then “@” the home club, and waits on it, when the viewer holds only the away club', async () => {
    await openLanding([
      scheduled(1, owns(false, true)),
      live(2, { viewerOwns: owns(false, true), yourMove: false }),
    ])

    const [scheduledRow, liveRow] = gameLinks()
    expectInOrder(scheduledRow, ['Harbor Kingfishers', '@ Ridgeview Rail', '(rail-skipper)'])
    expect(text(scheduledRow)).not.toContain('kingfisher-kid')
    expect(text(liveRow)).toContain('Waiting on Ridgeview Rail')
  })

  it('shows the inning, the score and “Your move” for a live game that needs the viewer', async () => {
    await openLanding([live(1, { inning: 4, half: Half.Bottom, score: { home: 5, away: 6 } })])

    const [row] = gameLinks()
    expect(text(row)).toContain('Bottom 4')
    expect(text(row)).toContain('5')
    expect(text(row)).toContain('6')
    expect(text(row)).toContain('Your move')
  })

  it('names the club it is waiting on when the viewer has locked', async () => {
    await openLanding([live(1, { yourMove: false })])

    const [row] = gameLinks()
    expect(text(row)).toContain('Waiting on Harbor Kingfishers')
    expect(text(row)).not.toContain('Your move')
  })

  it('reads “Ready to start” for a scheduled game', async () => {
    await openLanding([scheduled(1)])

    expect(text(gameLinks()[0])).toContain('Ready to start')
  })

  it('reads “Final” with the score for a finished game', async () => {
    await openLanding([final(1)])

    const [row] = gameLinks()
    expect(text(row)).toContain('Final')
    expect(text(row)).toContain('3')
    expect(text(row)).toContain('4')
    expect(text(row)).not.toContain('Your move')
  })

  it('turns “Waiting on…” into “Your move” when the server reports the opponent has committed', async () => {
    const { serverReports } = await openLanding([live(1, { yourMove: false })])

    serverReports([live(1, { yourMove: true })])

    await waitFor(() => {
      expect(text(gameLinks()[0])).toContain('Your move')
    })
    expect(text(gameLinks()[0])).not.toContain('Waiting on')
  })
})

describe('Landing — before and instead of a list', () => {
  it('shows a loading indicator, not the empty state, while the list loads', async () => {
    await openLanding(undefined)

    expect(screen.getByRole('status').textContent).toMatch(/loading/i)
    expect(screen.queryByText(/hasn’t been set up/i)).toBeNull()
    expect(screen.queryByRole('list', { name: /your games/i })).toBeNull()
  })

  it('tells a viewer with no games that a game hasn’t been set up for them yet, with no way to claim one', async () => {
    await openLanding([])

    screen.getByText(/a game hasn’t been set up for you yet/i)
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.queryByRole('list', { name: /your games/i })).toBeNull()
  })

  it('shows an error, not an empty list, when the list fails to load', async () => {
    // A Convex query that fails throws from `useQuery` during render.
    vi.spyOn(console, 'error').mockImplementation(() => {})
    sdk.listMyGames.mockImplementation(() => {
      throw new Error('server unavailable')
    })
    render(<App />)

    expect((await screen.findByRole('alert')).textContent).toMatch(/couldn’t load your games/i)
    expect(screen.queryByText(/hasn’t been set up/i)).toBeNull()
    screen.getByTestId('clerk-user-button')
  })

  it('does not ask for the list while signed out', async () => {
    sdk.signedIn = false
    render(<App />)

    await screen.findByTestId('clerk-sign-in')
    expect(sdk.listMyGames).not.toHaveBeenCalled()
  })
})
