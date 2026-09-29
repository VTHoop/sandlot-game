import { GameStatus } from '@sandlot/engine/game'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Id } from '../convex/_generated/dataModel'
import { ClubSide, type GameView } from '../convex/gameView'
import App from './App'

/**
 * The shell is tested through `<App />` at a real URL, with the two SDK seams it
 * reads — Clerk (who is signed in) and Convex (whether the session reached the
 * server, `users.provision`, `gameView.getGame`) — replaced by controllable
 * fakes. Clerk's prebuilt components become markers carrying the props the shell
 * is responsible for.
 */
const sdk = vi.hoisted(() => ({
  clerk: { isLoaded: true, isSignedIn: false },
  convex: { isLoading: false, isAuthenticated: false },
  provision: vi.fn<() => Promise<string>>(),
  getGame: vi.fn<(args: unknown) => GameView | null | undefined>(),
}))

vi.mock('@clerk/react', () => ({
  useAuth: () => sdk.clerk,
  SignIn: (props: { forceRedirectUrl?: string; signUpForceRedirectUrl?: string }) => (
    <div
      data-testid="clerk-sign-in"
      data-force-redirect-url={props.forceRedirectUrl}
      data-sign-up-force-redirect-url={props.signUpForceRedirectUrl}
    />
  ),
  UserButton: () => <div data-testid="clerk-user-button" />,
}))

vi.mock('convex/react', () => ({
  useConvexAuth: () => sdk.convex,
  useMutation: () => sdk.provision,
  useQuery: (_query: unknown, args: unknown) => sdk.getGame(args),
}))

function signedOut() {
  sdk.clerk = { isLoaded: true, isSignedIn: false }
  sdk.convex = { isLoading: false, isAuthenticated: false }
}

function signedIn() {
  sdk.clerk = { isLoaded: true, isSignedIn: true }
  sdk.convex = { isLoading: false, isAuthenticated: true }
}

/** A promise the test settles by hand, so the pending window is observable. */
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function openAt(path: string) {
  window.history.pushState({}, '', path)
  render(<App />)
}

const signInSurface = () => screen.queryByTestId('clerk-sign-in')
const userButton = () => screen.queryByTestId('clerk-user-button')

beforeEach(() => {
  signedOut()
  sdk.provision.mockReset().mockResolvedValue('users-row-id')
  sdk.getGame.mockReset().mockReturnValue(undefined)
})

afterEach(() => {
  cleanup()
  window.history.pushState({}, '', '/')
})

describe('App', () => {
  it('renders the Sandlot heading', () => {
    render(<App />)
    screen.getByRole('heading', { name: 'Sandlot' })
  })
})

describe('App — signed out', () => {
  it('shows the sign-in surface, not the authenticated area', () => {
    openAt('/')

    expect(signInSurface()).not.toBeNull()
    expect(userButton()).toBeNull()
    expect(sdk.provision).not.toHaveBeenCalled()
  })

  it('returns a deep link to the same URL after signing in or up', () => {
    openAt('/game/abc123?from=link')

    const surface = screen.getByTestId('clerk-sign-in')
    expect(surface.dataset.forceRedirectUrl).toBe('/game/abc123?from=link')
    expect(surface.dataset.signUpForceRedirectUrl).toBe('/game/abc123?from=link')
    expect(sdk.getGame).not.toHaveBeenCalled()
  })

  it('announces a loading state while the session is still being established', () => {
    sdk.clerk = { isLoaded: false, isSignedIn: false }
    sdk.convex = { isLoading: true, isAuthenticated: false }
    openAt('/')

    screen.getByRole('status')
    expect(signInSurface()).toBeNull()
  })

  it('keeps the /design showcase public: it renders while signed out', async () => {
    openAt('/design')

    await screen.findByRole('button', { name: 'LOCK IT IN' }, { timeout: 5000 })
    expect(signInSurface()).toBeNull()
  })

  it('waits, rather than looping back to sign-in, until the server accepts a Clerk session', () => {
    // Convex reports exactly this between Clerk signing in and the backend
    // confirming the token — the same reading a rejected token gives — so it is
    // a wait, not an error.
    sdk.clerk = { isLoaded: true, isSignedIn: true }
    sdk.convex = { isLoading: false, isAuthenticated: false }
    openAt('/')

    screen.getByRole('status')
    expect(signInSurface()).toBeNull()
    expect(sdk.provision).not.toHaveBeenCalled()
  })
})

describe('App — provisioning the signed-in user', () => {
  beforeEach(signedIn)

  it('calls users.provision on sign-in and shows only a loading state until it resolves', async () => {
    const pending = deferred<string>()
    sdk.provision.mockReturnValue(pending.promise)
    openAt('/')

    expect(sdk.provision).toHaveBeenCalledTimes(1)
    screen.getByRole('status')
    expect(userButton()).toBeNull()

    pending.resolve('users-row-id')
    await screen.findByTestId('clerk-user-button')
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('does not render a game route before provisioning resolves', () => {
    sdk.provision.mockReturnValue(new Promise(() => {}))
    openAt('/game/abc123')

    expect(sdk.getGame).not.toHaveBeenCalled()
  })

  it('shows an error with a keyboard-reachable retry when provisioning fails, and retries', async () => {
    sdk.provision.mockRejectedValueOnce(new Error('network down'))
    openAt('/')

    await screen.findByRole('alert')
    const retry = screen.getByRole('button', { name: /retry/i })
    retry.focus()
    expect(document.activeElement).toBe(retry)
    expect(userButton()).toBeNull()

    fireEvent.click(retry)
    expect(sdk.provision).toHaveBeenCalledTimes(2)
    await screen.findByTestId('clerk-user-button')
    expect(screen.queryByRole('alert')).toBeNull()
  })
})

describe('App — signed in', () => {
  beforeEach(signedIn)

  it('lands on / with the app name, a hint to open a game by URL, and the user button', async () => {
    openAt('/')

    await screen.findByTestId('clerk-user-button')
    screen.getByRole('heading', { name: 'Sandlot' })
    screen.getByText(/\/game\//)
  })

  it('shows page-not-found with a link home on a path that matches no route', async () => {
    openAt('/no/such/page')

    await screen.findByRole('heading', { name: /page not found/i })
    expect(screen.getByRole('link', { name: /home/i }).getAttribute('href')).toBe('/')
  })

  it('shows a loading state, not not-found, while the game is pending', async () => {
    openAt('/game/abc123')

    await screen.findByRole('status')
    expect(sdk.getGame).toHaveBeenCalledWith({ game: 'abc123' })
    expect(screen.queryByText(/not found/i)).toBeNull()
  })

  it('shows one combined not-found / not-yours state with a link home when getGame is null', async () => {
    sdk.getGame.mockReturnValue(null)
    openAt('/game/abc123')

    await screen.findByRole('heading', { name: /game not found/i })
    expect(screen.getByRole('link', { name: /home/i }).getAttribute('href')).toBe('/')
  })

  it('renders a placeholder naming the matchup for a game the viewer can read', async () => {
    sdk.getGame.mockReturnValue({
      status: GameStatus.Scheduled,
      id: 'abc123' as Id<'games'>,
      home: { id: 'home-club' as Id<'teams'>, name: 'Harbor Gulls' },
      away: { id: 'away-club' as Id<'teams'>, name: 'Mesa Coyotes' },
      viewer: ClubSide.Home,
    })
    openAt('/game/abc123')

    await screen.findByText(/Mesa Coyotes/)
    screen.getByText(/Harbor Gulls/)
    expect(screen.queryByText(/not found/i)).toBeNull()
  })
})
