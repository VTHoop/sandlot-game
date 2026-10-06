import { UserButton } from '@clerk/react'
import { GameStatus } from '@sandlot/engine/game'
import { useMutation, useQuery } from 'convex/react'
import { lazy, Suspense, useState } from 'react'
import { Navigate, useParams } from 'react-router'
import { api } from '../../convex/_generated/api'
import type { GameView } from '../../convex/gameView'
import { Button } from '../components/ui/Button'
import { MyGames } from './MyGames'
import { HomeLink, Screen, Title, Waiting, Wordmark } from './Screen'

/** `/` for a signed-in user: their games (SAN-72). */
export function Landing() {
  return (
    <Screen>
      <Wordmark />
      <MyGames />
      <UserButton />
    </Screen>
  )
}

// The duel is code-split: the reveal brings the motion library with it, and the
// sign-in and landing screens should not pay for that.
const LiveGame = lazy(() => import('./LiveGame'))

/** The wait every stage of `/game/:id` shows before it has something to render. */
function LoadingGame() {
  return (
    <Screen>
      <Waiting>Loading the game…</Waiting>
    </Screen>
  )
}

type ScheduledGame = Extract<GameView, { status: GameStatus.Scheduled }>

/** Where a start request stands. */
enum Start {
  Idle = 'idle',
  Pending = 'pending',
  Failed = 'failed',
}

/**
 * A scheduled game: the matchup and the one thing to do with it. `startGame`
 * flips the game live on the server and the subscription re-renders this route
 * as the duel — so a successful start stays `Pending` (button disabled) until
 * that arrives, rather than navigating anywhere itself.
 */
function StartGame({ game }: { game: ScheduledGame }) {
  const startGame = useMutation(api.game.startGame)
  const [start, setStart] = useState(Start.Idle)

  const begin = () => {
    setStart(Start.Pending)
    startGame({ game: game.id }).catch(() => {
      setStart(Start.Failed)
    })
  }

  return (
    <Screen>
      <Title>
        {game.away.name} at {game.home.name}
      </Title>
      {start === Start.Failed && (
        <p role="alert" className="text-sm text-chalk">
          Couldn’t start the game. Try again.
        </p>
      )}
      <Button
        variant="consequence"
        className="px-6 py-3 text-sm"
        disabled={start === Start.Pending}
        onClick={begin}
      >
        START GAME
      </Button>
      <HomeLink />
    </Screen>
  )
}

/**
 * `/game/:id` (SAN-39). The id is passed to `getGame` as typed; the server folds
 * a malformed one into the same `null` as a game that does not exist or is not
 * the viewer's (ADR-0025), so this screen cannot tell those cases apart — and
 * does not try: all three go home.
 *
 * What renders follows the game's status, as the server reports it: a scheduled
 * game offers to start; a live or final one is the duel (`./LiveGame`), which
 * ends on the game-over screen. Live and final render the same element in the
 * same place, so a game that ends while the duel is on screen keeps that
 * instance — and with it, the game-ending at-bat still to reveal (SAN-67).
 */
export function GameScreen() {
  const { id } = useParams<'id'>()
  if (id === undefined) throw new Error('GameScreen rendered outside /game/:id')
  const game = useQuery(api.gameView.getGame, { game: id })

  if (game === undefined) return <LoadingGame />
  if (game === null) return <Navigate to="/" replace />
  if (game.status === GameStatus.Scheduled) return <StartGame game={game} />
  return (
    <Suspense fallback={<LoadingGame />}>
      <LiveGame game={game} />
    </Suspense>
  )
}

/** Any signed-in path no route claims. */
export function NotFound() {
  return (
    <Screen>
      <Title>Page not found</Title>
      <HomeLink />
    </Screen>
  )
}
