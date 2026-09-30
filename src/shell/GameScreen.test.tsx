import { GameStatus, Half } from '@sandlot/engine/game'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ConvexError } from 'convex/values'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { DuelRejection, type ResolvedAtBatView } from '../../convex/duelContract'
import type { GameView } from '../../convex/gameView'
import App from '../App'
import { CLUBS, GAME_ID, liveView, locks, owns, resolvedAtBat } from '../duel/testing/liveViews'

/**
 * `/game/:id` tested through `<App />` at a real URL (SAN-39). The two Convex
 * subscriptions the screen reads and the three mutations it sends are replaced
 * by controllable fakes, keyed by function name — so a test plays the SERVER: it
 * sets what the subscriptions report, re-renders, and watches the screen follow.
 * That is the whole claim of a server-driven screen.
 */
const sdk = vi.hoisted(() => ({
  getGame: vi.fn<(args: unknown) => GameView | null | undefined>(),
  getLastAtBat: vi.fn<(args: unknown) => ResolvedAtBatView | null | undefined>(),
  provision: vi.fn<() => Promise<string>>(),
  startGame: vi.fn<(args: unknown) => Promise<null>>(),
  commitPitch: vi.fn<(args: unknown) => Promise<unknown>>(),
  commitSwing: vi.fn<(args: unknown) => Promise<unknown>>(),
  /** Every query the app subscribed to, by name — what crossed the wire. */
  subscribed: new Set<string>(),
}))

vi.mock('@clerk/react', () => ({
  useAuth: () => ({ isLoaded: true, isSignedIn: true }),
  SignIn: () => null,
  UserButton: () => <div data-testid="clerk-user-button" />,
}))

vi.mock('convex/react', async () => {
  const { getFunctionName } = await import('convex/server')
  type Ref = Parameters<typeof getFunctionName>[0]
  const queries = new Map<string, (args: unknown) => unknown>([
    ['gameView:getGame', (args) => sdk.getGame(args)],
    ['atBatView:getLastAtBat', (args) => sdk.getLastAtBat(args)],
  ])
  const mutations = new Map<string, (args: unknown) => Promise<unknown>>([
    ['users:provision', () => sdk.provision()],
    ['game:startGame', (args) => sdk.startGame(args)],
    ['atBat:commitPitch', (args) => sdk.commitPitch(args)],
    ['atBat:commitSwing', (args) => sdk.commitSwing(args)],
  ])
  const named = <T,>(table: Map<string, T>, ref: Ref): T => {
    const name = getFunctionName(ref)
    const found = table.get(name)
    if (!found) throw new Error(`the screen reached for ${name}, which this test does not fake`)
    return found
  }
  return {
    useConvexAuth: () => ({ isLoading: false, isAuthenticated: true }),
    useQuery: (ref: Ref, args: unknown) => {
      if (args === 'skip') return undefined
      sdk.subscribed.add(getFunctionName(ref))
      return named(queries, ref)(args)
    },
    useMutation: (ref: Ref) => named(mutations, ref),
  }
})

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

beforeEach(() => {
  sdk.getGame.mockReset().mockReturnValue(undefined)
  sdk.getLastAtBat.mockReset().mockReturnValue(null)
  sdk.provision.mockReset().mockResolvedValue('users-row-id')
  sdk.startGame.mockReset().mockResolvedValue(null)
  sdk.commitPitch.mockReset().mockResolvedValue(null)
  sdk.commitSwing.mockReset().mockResolvedValue(null)
  sdk.subscribed.clear()
})

afterEach(() => {
  cleanup()
  window.history.pushState({}, '', '/')
})

const PATH = `/game/${GAME_ID}`

/** Open the game route with the server reporting `game` (and `lastAtBat`). */
async function open(game: GameView | null, lastAtBat: ResolvedAtBatView | null = null) {
  sdk.getGame.mockReturnValue(game)
  sdk.getLastAtBat.mockReturnValue(lastAtBat)
  window.history.pushState({}, '', PATH)
  const view = render(<App />)
  // The provisioning gate resolves on a microtask; let the route mount.
  await waitFor(() => {
    expect(sdk.getGame).toHaveBeenCalled()
  })
  /** The server pushes new state down the subscriptions. */
  const serverReports = (next: { game?: GameView; lastAtBat?: ResolvedAtBatView | null }) => {
    if (next.game) sdk.getGame.mockReturnValue(next.game)
    if (next.lastAtBat !== undefined) sdk.getLastAtBat.mockReturnValue(next.lastAtBat)
    view.rerender(<App />)
  }
  return { serverReports }
}

const scheduled: GameView = {
  id: GAME_ID,
  status: GameStatus.Scheduled,
  ...CLUBS,
  viewer: liveView().viewer,
  viewerOwns: owns(false, true),
}

const numberInput = () => screen.getByLabelText<HTMLInputElement>(/your number/i)
const button = (name: string | RegExp) => screen.getByRole<HTMLButtonElement>('button', { name })

function lockNumber(value: number) {
  fireEvent.change(numberInput(), { target: { value: String(value) } })
  fireEvent.click(button('LOCK IT IN'))
}

/** A commit the server refused, as `ConvexError` carries it (ADR-0026). */
const refusal = (rejection: DuelRejection, reason: string) => new ConvexError({ rejection, reason })

describe('/game/:id — a game the viewer cannot read', () => {
  it('goes home without an error when getGame is null', async () => {
    await open(null)

    await screen.findByText(/open your game’s link/i)
    expect(window.location.pathname).toBe('/')
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByText(/not found/i)).toBeNull()
  })
})

describe('/game/:id — a scheduled game', () => {
  it('names the matchup and offers to start it', async () => {
    await open(scheduled)

    await screen.findByRole('heading', { name: 'Harbor Kingfishers at Ridgeview Rail' })
    expect(button('START GAME').disabled).toBe(false)
    expect(sdk.startGame).not.toHaveBeenCalled()
  })

  it('starts the game once, and cannot be pressed again while that is in flight', async () => {
    sdk.startGame.mockReturnValue(new Promise(() => {}))
    await open(scheduled)

    fireEvent.click(await screen.findByRole('button', { name: 'START GAME' }))

    expect(sdk.startGame).toHaveBeenCalledExactlyOnceWith({ game: GAME_ID })
    expect(button('START GAME').disabled).toBe(true)
    fireEvent.click(button('START GAME'))
    expect(sdk.startGame).toHaveBeenCalledTimes(1)
  })

  it('says so when the start fails, and lets the viewer try again', async () => {
    sdk.startGame.mockRejectedValueOnce(new Error('boom'))
    await open(scheduled)

    fireEvent.click(await screen.findByRole('button', { name: 'START GAME' }))

    expect((await screen.findByRole('alert')).textContent).toBe(
      'Couldn’t start the game. Try again.',
    )
    expect(button('START GAME').disabled).toBe(false)
    fireEvent.click(button('START GAME'))
    expect(sdk.startGame).toHaveBeenCalledTimes(2)
  })

  it('drops into the at-bat when the server reports the game live', async () => {
    const { serverReports } = await open(scheduled)
    await screen.findByRole('button', { name: 'START GAME' })

    serverReports({ game: liveView() })

    await screen.findByLabelText(/your number/i)
    expect(screen.queryByRole('button', { name: 'START GAME' })).toBeNull()
  })
})

describe('/game/:id — a live game, on load', () => {
  it('opens on the viewer’s commit screen, from server state alone', async () => {
    await open(liveView())

    await screen.findByLabelText(/your number/i)
    // The batter's screen: the chip is about the pitch.
    screen.getByText('H. MARSH’s pitch')
    screen.getByText('HAR @ RID')
    screen.getByText('TOP 3RD')
    screen.getByRole('img', { name: '1 out' })
  })

  it('opens on waiting when the viewer’s seat is already locked', async () => {
    await open(liveView({ locks: locks(false, true) }))

    await screen.findByText('WAITING ON H. MARSH’S PITCH')
    expect(screen.queryByLabelText(/your number/i)).toBeNull()
  })

  it('does not replay an at-bat that resolved before the page was opened', async () => {
    await open(liveView(), resolvedAtBat())

    await screen.findByLabelText(/your number/i)
    expect(screen.queryByRole('button', { name: '↺ REPLAY' })).toBeNull()
  })

  it('names the runner on base in the field’s description', async () => {
    await open(liveView())
    await screen.findByRole('img', { name: 'T. JULIEN on 2nd' })
  })

  it('shows the scoreboard the server reports: away then home', async () => {
    await open(liveView())
    await screen.findByLabelText(/your number/i)

    const cell = (label: string) =>
      screen.getByText(label).parentElement?.parentElement?.textContent
    expect(cell('HAR')).toBe('HAR4 HITS1runs')
    expect(cell('RID')).toBe('RID5 HITS2runs')
  })

  it('asks the server for the game and the last at-bat, and nothing that could carry a live number', async () => {
    await open(liveView({ locks: locks(true, false) }))
    await screen.findByText('🔒 LOCKED')

    // The screen cannot show a number it never fetched: `getActiveDuel` is not
    // subscribed to, and neither view it does read can hold an unresolved number.
    expect([...sdk.subscribed].sort()).toEqual(['atBatView:getLastAtBat', 'gameView:getGame'])
  })
})

describe('/game/:id — committing', () => {
  it('sends the batter’s number through commitSwing, once', async () => {
    await open(liveView())
    await screen.findByLabelText(/your number/i)

    lockNumber(472)

    expect(sdk.commitSwing).toHaveBeenCalledExactlyOnceWith({ game: GAME_ID, number: 472 })
    expect(sdk.commitPitch).not.toHaveBeenCalled()
  })

  it('sends the pitcher’s number through commitPitch, once', async () => {
    await open(liveView({ viewerOwns: owns(true, false) }))
    await screen.findByText('R. VANCE’s swing')

    lockNumber(519)

    expect(sdk.commitPitch).toHaveBeenCalledExactlyOnceWith({ game: GAME_ID, number: 519 })
    expect(sdk.commitSwing).not.toHaveBeenCalled()
  })

  it('walks an owner of both clubs through the pitch, then the swing', async () => {
    const hotseat = { viewerOwns: owns(true, true) }
    const { serverReports } = await open(liveView(hotseat))
    await screen.findByText('R. VANCE’s swing')
    lockNumber(519)

    serverReports({ game: liveView({ ...hotseat, locks: locks(true, false) }) })

    // A fresh, empty entry for the batter's seat, told the pitch is in.
    await screen.findByText('H. MARSH’s pitch')
    screen.getByText('🔒 LOCKED')
    expect(numberInput().value).toBe('')
    lockNumber(472)
    expect(sdk.commitSwing).toHaveBeenCalledExactlyOnceWith({ game: GAME_ID, number: 472 })
    expect(sdk.commitPitch).toHaveBeenCalledTimes(1)
  })
})

describe('/game/:id — waiting, then the reveal', () => {
  /** The at-bat on screen resolves: the log gains a row, and the next at-bat opens. */
  const RESOLVED = resolvedAtBat({
    sequence: 0,
    inning: 3,
    half: Half.Top,
    pitcher: { id: liveView().pitcher.id, name: 'H. MARSH' },
    batter: { id: liveView().batter.id, name: 'R. VANCE' },
    basesAfter: { first: null, second: liveView().batter.id, third: null },
    scoreBefore: { home: 2, away: 1 },
    hitsBefore: { home: 5, away: 4 },
  })

  async function waitingOnThePitch() {
    const opened = await open(liveView({ locks: locks(false, true) }))
    await screen.findByText('WAITING ON H. MARSH’S PITCH')
    return opened
  }

  it('moves to the reveal when the server reports the at-bat resolved, with no reload', async () => {
    const { serverReports } = await waitingOnThePitch()

    serverReports({ game: liveView(), lastAtBat: RESOLVED })

    expect((await screen.findByRole('status')).textContent).toBe('DOUBLE!')
    // Both numbers, now that both seats have locked.
    screen.getByText('519')
    screen.getByText('472')
    screen.getByText('1 run scores · R. VANCE stands on 2nd')
  })

  it('shows the settled reveal at once under reduced motion, as the showcase does', async () => {
    const { serverReports } = await waitingOnThePitch()
    serverReports({ game: liveView(), lastAtBat: RESOLVED })
    await screen.findByRole('status')

    // The run and the hit are already on the batting club's row — no tick to wait for.
    const cell = (label: string) =>
      screen.getByText(label).parentElement?.parentElement?.textContent
    expect(cell('HAR')).toBe('HAR5 HITS2runs')
    expect(cell('RID')).toBe('RID5 HITS2runs')
  })

  it('goes on to the next at-bat when the reveal is advanced', async () => {
    const { serverReports } = await waitingOnThePitch()
    serverReports({ game: liveView(), lastAtBat: RESOLVED })

    fireEvent.click(await screen.findByRole('button', { name: 'NEXT BATTER →' }))

    await screen.findByLabelText(/your number/i)
    expect(screen.queryByRole('button', { name: '↺ REPLAY' })).toBeNull()
  })

  it('finishes the reveal it is showing when another at-bat resolves underneath it', async () => {
    // One session cannot do this — nothing resolves without the viewer's own
    // commit — but a second tab or device on the same account can. The reveal on
    // screen must not turn into a different play part-way through.
    const { serverReports } = await waitingOnThePitch()
    serverReports({ game: liveView(), lastAtBat: RESOLVED })
    expect((await screen.findByRole('status')).textContent).toBe('DOUBLE!')

    serverReports({
      lastAtBat: { ...RESOLVED, sequence: 1, outcome: 'K', runsScored: 0, outsAfter: 2 },
    })
    expect(screen.getByRole('status').textContent).toBe('DOUBLE!')

    // Advancing past the one that was watched reveals the one that arrived.
    fireEvent.click(screen.getByRole('button', { name: 'NEXT BATTER →' }))
    await waitFor(() => {
      expect(screen.getByRole('status').textContent).toBe('STRIKEOUT')
    })
    fireEvent.click(screen.getByRole('button', { name: 'NEXT BATTER →' }))
    await screen.findByLabelText(/your number/i)
  })

  it('ends on the half summary after the third out, with nowhere further to go', async () => {
    const { serverReports } = await waitingOnThePitch()
    serverReports({
      // The server has already turned the half over.
      game: liveView({ half: Half.Bottom, outs: 0 }),
      lastAtBat: { ...RESOLVED, outcome: 'K', runsScored: 0, outsAfter: 3, endedHalf: true },
    })

    fireEvent.click(await screen.findByRole('button', { name: 'END OF HALF →' }))

    await screen.findByRole('heading', { name: 'END OF HALF' })
    screen.getByText('TOP 3RD · in the books')
    // The end of this ticket's flow: moving on is SAN-67's.
    expect(screen.queryAllByRole('button')).toHaveLength(0)
    expect(screen.queryByLabelText(/your number/i)).toBeNull()
  })
})

describe('/game/:id — a commit that does not land', () => {
  it('shows the server’s reason for a refusal and follows server state, without committing again', async () => {
    sdk.commitSwing.mockRejectedValueOnce(
      refusal(DuelRejection.ReEnterable, 'Your number is already committed for this at-bat'),
    )
    const { serverReports } = await open(liveView())
    await screen.findByLabelText(/your number/i)

    lockNumber(472)

    expect((await screen.findByRole('alert')).textContent).toBe(
      'Your number is already committed for this at-bat',
    )
    // The server's word is that this seat IS locked: the screen goes where it says.
    serverReports({ game: liveView({ locks: locks(false, true) }) })
    await screen.findByText('WAITING ON H. MARSH’S PITCH')
    expect(sdk.commitSwing).toHaveBeenCalledTimes(1)
  })

  it('shows a terminal refusal’s reason too, and does not crash', async () => {
    sdk.commitSwing.mockRejectedValueOnce(refusal(DuelRejection.Terminal, 'Game is not live'))
    await open(liveView())
    await screen.findByLabelText(/your number/i)

    lockNumber(472)

    expect((await screen.findByRole('alert')).textContent).toBe('Game is not live')
    screen.getByText('HAR @ RID')
  })

  it('says the number did not send on any other failure, and lets the viewer enter it again', async () => {
    sdk.commitSwing.mockRejectedValueOnce(new Error('network'))
    await open(liveView())
    await screen.findByLabelText(/your number/i)

    lockNumber(472)

    expect((await screen.findByRole('alert')).textContent).toBe(
      'Couldn’t send your number. Try again.',
    )
    // A fresh entry, not a locked one.
    await waitFor(() => {
      expect(numberInput().disabled).toBe(false)
    })
    lockNumber(472)
    expect(sdk.commitSwing).toHaveBeenCalledTimes(2)
  })

  it('clears the alert once a commit lands', async () => {
    sdk.commitSwing.mockRejectedValueOnce(new Error('network'))
    await open(liveView())
    await screen.findByLabelText(/your number/i)
    lockNumber(472)
    await screen.findByRole('alert')
    await waitFor(() => {
      expect(numberInput().disabled).toBe(false)
    })

    lockNumber(472)

    await waitFor(() => {
      expect(screen.queryByRole('alert')).toBeNull()
    })
  })
})

describe('/game/:id — a finished game', () => {
  it('keeps the placeholder: how a final game renders is SAN-67’s', async () => {
    await open({
      id: GAME_ID,
      status: GameStatus.Final,
      ...CLUBS,
      viewer: liveView().viewer,
      viewerOwns: owns(false, true),
      score: { home: 3, away: 1 },
      hits: { home: 6, away: 4 },
      winner: null,
    })

    await screen.findByRole('heading', { name: 'Harbor Kingfishers at Ridgeview Rail' })
    screen.getByText('The game screen is on its way.')
    expect(screen.queryByRole('button', { name: 'START GAME' })).toBeNull()
  })
})
