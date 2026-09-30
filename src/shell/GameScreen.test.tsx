import { GameStatus, Half } from '@sandlot/engine/game'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { ConvexError } from 'convex/values'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { DuelRejection, type ResolvedAtBatView } from '../../convex/duelContract'
import type { GameView } from '../../convex/gameView'
import App from '../App'
import {
  CLUBS,
  finalView,
  GAME_ID,
  liveView,
  locks,
  owns,
  resolvedAtBat,
} from '../duel/testing/liveViews'

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

describe('/game/:id — between halves (SAN-67)', () => {
  /** The third out of the top of the 3rd, struck while the viewer waited. */
  const THIRD_OUT = resolvedAtBat({
    sequence: 0,
    inning: 3,
    half: Half.Top,
    outcome: 'K',
    runsScored: 0,
    outsBefore: 2,
    outsAfter: 3,
    endedHalf: true,
    halfTotals: { runs: 0, hits: 1 },
  })
  /** The server has already turned the half over: the bottom of the 3rd is open. */
  const NEXT_HALF = { half: Half.Bottom, outs: 0 }

  async function thirdOutRevealed(viewerOwns = owns(false, true)) {
    const opened = await open(liveView({ viewerOwns, locks: locks(false, true) }))
    // The duel is on screen once it has subscribed to the reveal. Waiting on a
    // screen's text would not do: an owner of both clubs drives the open seat,
    // so what they see is a commit entry, not a wait.
    await waitFor(() => {
      expect(sdk.getLastAtBat).toHaveBeenCalled()
    })
    opened.serverReports({ game: liveView({ ...NEXT_HALF, viewerOwns }), lastAtBat: THIRD_OUT })
    fireEvent.click(await screen.findByRole('button', { name: 'END OF HALF →' }))
    await screen.findByRole('heading', { name: 'END OF HALF' })
    return opened
  }

  it('shows the half summary and the side change, from the server’s state', async () => {
    await thirdOutRevealed()

    screen.getByText('TOP 3RD · in the books')
    screen.getByText('BOT 3RD · Ridgeview Rail bats')
    expect(screen.queryByLabelText(/your number/i)).toBeNull()
  })

  it('leads with the game score as the half left it, away then home (SAN-70)', async () => {
    await thirdOutRevealed()

    // HAR 3, RID 2 before the third out, which scored nothing.
    expect(screen.getByRole('region', { name: 'Score' }).textContent).toBe('HAR3RID2')
    const half = screen.getByRole('region', { name: 'This half' })
    expect(within(half).getByText('HITS').nextElementSibling?.textContent).toBe('1')
  })

  it('hands focus to the continue control when the card appears', async () => {
    await thirdOutRevealed()

    await waitFor(() => {
      expect(document.activeElement).toBe(button('CONTINUE →'))
    })
  })

  it('stays up until the player continues, whatever the server does meanwhile', async () => {
    const { serverReports } = await thirdOutRevealed()

    // The other seat locks into the next at-bat while the card is up.
    serverReports({ game: liveView({ ...NEXT_HALF, locks: locks(true, false) }) })

    screen.getByRole('heading', { name: 'END OF HALF' })
    expect(screen.queryByLabelText(/your number/i)).toBeNull()
  })

  it('opens the next half’s first at-bat once the player continues', async () => {
    await thirdOutRevealed()

    fireEvent.click(button('CONTINUE →'))

    await screen.findByLabelText(/your number/i)
    screen.getByText('BOT 3RD')
    expect(screen.queryByRole('heading', { name: 'END OF HALF' })).toBeNull()
  })

  it('shows the same card to an owner of both clubs', async () => {
    await thirdOutRevealed(owns(true, true))

    screen.getByText('BOT 3RD · Ridgeview Rail bats')
    fireEvent.click(button('CONTINUE →'))
    await screen.findByLabelText(/your number/i)
  })

  it('lands on the next half’s first at-bat on a reload between halves, not on the card', async () => {
    await open(liveView(NEXT_HALF), THIRD_OUT)

    await screen.findByLabelText(/your number/i)
    screen.getByText('BOT 3RD')
    expect(screen.queryByRole('heading', { name: 'END OF HALF' })).toBeNull()
  })
})

describe('/game/:id — the game ends (SAN-67)', () => {
  /** A two-run walk-off homer in the bottom of the 6th: 3–4 becomes 5–4. */
  const WALK_OFF = resolvedAtBat({
    sequence: 40,
    inning: 6,
    half: Half.Bottom,
    outcome: 'HR',
    runsScored: 2,
    outsBefore: 1,
    outsAfter: 1,
    basesBefore: { first: 'r9', second: null, third: null },
    basesAfter: { first: null, second: null, third: null },
    scoreBefore: { home: 3, away: 4 },
    endedHalf: false,
  })
  const WALK_OFF_FINAL = finalView({
    score: { home: 5, away: 4 },
    hits: { home: 8, away: 7 },
    lineScore: [
      { inning: 1, away: 2, home: 0 },
      { inning: 2, away: 0, home: 1 },
      { inning: 3, away: 0, home: 0 },
      { inning: 4, away: 2, home: 2 },
      { inning: 5, away: 0, home: 0 },
      { inning: 6, away: 0, home: 2 },
    ],
  })
  /** The third out of the top of the 6th, with the home club ahead: the game is over. */
  const LAST_OUT = resolvedAtBat({
    sequence: 38,
    inning: 6,
    half: Half.Top,
    outcome: 'K',
    runsScored: 0,
    outsBefore: 2,
    outsAfter: 3,
    endedHalf: true,
    scoreBefore: { home: 3, away: 1 },
  })

  async function waitingInTheLastHalf() {
    const opened = await open(liveView({ inning: 6, locks: locks(false, true) }))
    await screen.findByText('WAITING ON H. MARSH’S PITCH')
    return opened
  }

  it('reveals a walk-off, then shows the game-over screen', async () => {
    const { serverReports } = await waitingInTheLastHalf()

    serverReports({ game: WALK_OFF_FINAL, lastAtBat: WALK_OFF })

    await screen.findByRole('status')
    fireEvent.click(button('FINAL SCORE →'))
    await screen.findByRole('heading', { name: 'FINAL' })
  })

  it('reveals the last out, then goes to game-over with no half-transition card', async () => {
    const { serverReports } = await waitingInTheLastHalf()

    serverReports({ game: finalView(), lastAtBat: LAST_OUT })

    fireEvent.click(await screen.findByRole('button', { name: 'FINAL SCORE →' }))
    await screen.findByRole('heading', { name: 'FINAL' })
    expect(screen.queryByRole('heading', { name: 'END OF HALF' })).toBeNull()
  })

  it('lands on the game-over screen on a reload after the final, without replaying the last play', async () => {
    await open(finalView(), LAST_OUT)

    await screen.findByRole('heading', { name: 'FINAL' })
    expect(screen.queryByRole('status')).toBeNull()
    expect(screen.queryByRole('button', { name: '↺ REPLAY' })).toBeNull()
  })

  it('names the winner and the final score', async () => {
    await open(finalView())

    await screen.findByRole('heading', { name: 'FINAL' })
    screen.getByText('Ridgeview Rail win')
    screen.getByText('3–1')
  })

  it('hands focus to its heading when it appears', async () => {
    await open(finalView())

    const heading = await screen.findByRole('heading', { name: 'FINAL' })
    await waitFor(() => {
      expect(document.activeElement).toBe(heading)
    })
  })

  it('offers a link home and no other action', async () => {
    await open(finalView())
    await screen.findByRole('heading', { name: 'FINAL' })

    expect(screen.getByRole('link', { name: 'Back to home' }).getAttribute('href')).toBe('/')
    expect(screen.queryAllByRole('button')).toHaveLength(0)
  })
})

describe('/game/:id — the line score (SAN-67)', () => {
  const lineScore = () => within(screen.getByRole('table', { name: 'Line score' }))
  /** The table row a club's row header sits in. */
  const rowOf = (club: string) => {
    const row = lineScore().getByRole('rowheader', { name: club }).closest('tr')
    if (!row) throw new Error(`no line score row for ${club}`)
    return row
  }
  const cellsOf = (club: string) =>
    within(rowOf(club))
      .getAllByRole('cell')
      .map((cell) => cell.textContent)

  it('has a column per inning played, then R and H', async () => {
    await open(finalView())
    await screen.findByRole('heading', { name: 'FINAL' })

    const headers = lineScore()
      .getAllByRole('columnheader')
      .map((header) => header.textContent)
    expect(headers).toEqual(['Club', '1', '2', '3', '4', '5', '6', 'R', 'H'])
  })

  it('reads away then home, each club’s runs by inning and its totals', async () => {
    await open(finalView())
    await screen.findByRole('heading', { name: 'FINAL' })

    const rowHeaders = lineScore().getAllByRole('rowheader')
    expect(rowHeaders.map((header) => header.getAttribute('aria-label'))).toEqual([
      'Harbor Kingfishers',
      'Ridgeview Rail',
    ])
    expect(cellsOf('Harbor Kingfishers')).toEqual(['0', '0', '1', '0', '0', '0', '1', '4'])
  })

  it('marks an unplayed bottom half "X"', async () => {
    await open(finalView())
    await screen.findByRole('heading', { name: 'FINAL' })

    expect(cellsOf('Ridgeview Rail')).toEqual(['2', '0', '0', '1', '0', 'X', '3', '6'])
  })

  it('shows a walk-off inning’s runs as scored, unmarked', async () => {
    await open(
      finalView({
        score: { home: 2, away: 1 },
        lineScore: [
          { inning: 1, away: 1, home: 0 },
          { inning: 2, away: 0, home: 0 },
          { inning: 3, away: 0, home: 0 },
          { inning: 4, away: 0, home: 0 },
          { inning: 5, away: 0, home: 0 },
          { inning: 6, away: 0, home: 2 },
        ],
      }),
    )
    await screen.findByRole('heading', { name: 'FINAL' })

    expect(cellsOf('Ridgeview Rail').slice(0, 6)).toEqual(['0', '0', '0', '0', '0', '2'])
  })

  it('grows a column for each extra inning', async () => {
    const regulation = finalView().lineScore.slice(0, 5)
    await open(
      finalView({
        score: { home: 3, away: 2 },
        lineScore: [
          ...regulation,
          { inning: 6, away: 1, home: 0 },
          { inning: 7, away: 0, home: 0 },
          { inning: 8, away: 0, home: 0 },
        ],
      }),
    )
    await screen.findByRole('heading', { name: 'FINAL' })

    const headers = lineScore()
      .getAllByRole('columnheader')
      .map((header) => header.textContent)
    expect(headers).toEqual(['Club', '1', '2', '3', '4', '5', '6', '7', '8', 'R', 'H'])
  })

  it('sits in its own named, keyboard-reachable region, so wide lines scroll there and not the page', async () => {
    await open(finalView())
    await screen.findByRole('heading', { name: 'FINAL' })

    const region = screen.getByRole('region', { name: 'Line score' })
    expect(region.contains(screen.getByRole('table', { name: 'Line score' }))).toBe(true)
    // WCAG 2.1.1: Safari does not make a scroller focusable on its own.
    expect(region.tabIndex).toBe(0)
  })
})
