import { UserButton } from '@clerk/react'
import { GameStatus } from '@sandlot/engine/game'
import { useMutation, useQuery } from 'convex/react'
import { lazy, Suspense, useState } from 'react'
import { Navigate, useParams } from 'react-router'
import { api } from '../../convex/_generated/api'
import type { GameView } from '../../convex/gameView'
import { Button } from '../components/ui/Button'
import { HomeLink, Screen, Title, Waiting, Wordmark } from './Screen'

/** `/` for a signed-in user. Games are opened by link; there is no list yet. */
export function Landing() {
  return (
    <Screen>
      <Wordmark />
      <p className="text-sm text-muted">To play, open your game’s link. It looks like /game/…</p>
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
 * game offers to start, a live one is the duel (`./LiveGame`). How a final
 * game renders is SAN-67's; until then it keeps the placeholder.
 */
export function GameScreen() {
  const { id } = useParams<'id'>()
  if (id === undefined) throw new Error('GameScreen rendered outside /game/:id')
  const game = useQuery(api.gameView.getGame, { game: id })

  if (game === undefined) return <LoadingGame />
  if (game === null) return <Navigate to="/" replace />
  if (game.status === GameStatus.Live) {
    return (
      <Suspense fallback={<LoadingGame />}>
        <LiveGame game={game} />
      </Suspense>
    )
  }
  if (game.status === GameStatus.Scheduled) return <StartGame game={game} />
  return (
    <Screen>
      <Title>
        {game.away.name} at {game.home.name}
      </Title>
      <p className="text-sm text-muted">The game screen is on its way.</p>
      <HomeLink />
    </Screen>
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
