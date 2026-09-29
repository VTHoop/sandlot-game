import { UserButton } from '@clerk/react'
import { useQuery } from 'convex/react'
import { useParams } from 'react-router'
import { api } from '../../convex/_generated/api'
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

/**
 * `/game/:id`. A placeholder until the duel moves in (SAN-39). The id is passed
 * to `getGame` as typed; the server folds a malformed one into the same `null`
 * as a game that does not exist or is not the viewer's (ADR-0025), so this
 * screen cannot tell those cases apart — and must not try.
 */
export function GameScreen() {
  const { id } = useParams<'id'>()
  if (id === undefined) throw new Error('GameScreen rendered outside /game/:id')
  const game = useQuery(api.gameView.getGame, { game: id })

  if (game === undefined) {
    return (
      <Screen>
        <Waiting>Loading the game…</Waiting>
      </Screen>
    )
  }
  if (game === null) {
    return (
      <Screen>
        <Title>Game not found</Title>
        <p className="text-sm text-muted">This game doesn’t exist, or it isn’t one of yours.</p>
        <HomeLink />
      </Screen>
    )
  }
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
