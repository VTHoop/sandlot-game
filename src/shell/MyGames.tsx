import { GameStatus, Half } from '@sandlot/engine/game'
import { useQuery } from 'convex/react'
import { Component, type ReactNode } from 'react'
import { Link } from 'react-router'
import { api } from '../../convex/_generated/api'
import type { ClubView } from '../../convex/gameView'
import type { GameListEntry } from '../../convex/myGames'
import { Waiting } from './Screen'

/**
 * The signed-in viewer's games, as the landing screen lists them (SAN-72). The
 * server orders the rows and caps the finals; this renders them as it is told,
 * and the subscription re-renders it when a game moves.
 */
export function MyGames() {
  return (
    <ListErrorBoundary>
      <GameList />
    </ListErrorBoundary>
  )
}

function GameList() {
  const games = useQuery(api.myGames.listMyGames, {})

  if (games === undefined) return <Waiting>Loading your games…</Waiting>
  if (!games.length) {
    return <p className="text-sm text-muted">A game hasn’t been set up for you yet.</p>
  }
  return (
    <ul aria-label="Your games" className="flex w-full flex-col gap-3">
      {games.map((game) => (
        <li key={game.id}>
          <GameRow game={game} />
        </li>
      ))}
    </ul>
  )
}

/** One game: who it is against, where it stands, and what it is waiting for. A
 * single link, so the whole row opens the game and is one stop for the keyboard. */
function GameRow({ game }: { game: GameListEntry }) {
  return (
    <Link
      to={`/game/${game.id}`}
      className="flex flex-col gap-1 rounded-(--radius-tile) border border-edge bg-surface px-4 py-3 text-left focus-visible:outline-2 focus-visible:outline-consequence"
    >
      <span className="font-display uppercase tracking-wider text-chalk">{matchupOf(game)}</span>
      <StandingLine game={game} />
      <span className="text-sm text-consequence">{statusOf(game)}</span>
    </Link>
  )
}

/** The club across the field — or both, for a viewer who holds both. */
function matchupOf({ home, away, viewerOwns }: GameListEntry): string {
  if (viewerOwns.home && viewerOwns.away) return `${away.name} at ${home.name}`
  return viewerOwns.home ? `vs ${away.name}` : `at ${home.name}`
}

const opponentOf = ({ home, away, viewerOwns }: GameListEntry): ClubView =>
  viewerOwns.home ? away : home

/** The inning and score of a game under way, or the score of a finished one. */
function StandingLine({ game }: { game: GameListEntry }) {
  if (game.status === GameStatus.Scheduled) return null
  const score = `${game.away.name} ${game.score.away}, ${game.home.name} ${game.score.home}`
  const when =
    game.status === GameStatus.Live
      ? `${game.half === Half.Top ? 'Top' : 'Bottom'} ${game.inning}`
      : 'Final'
  return (
    <span className="text-sm text-muted">
      {when} · {score}
    </span>
  )
}

/** What the game is waiting for, in words. */
function statusOf(game: GameListEntry): string {
  if (game.status === GameStatus.Scheduled) return 'Ready to start'
  if (game.status === GameStatus.Final) return 'Final'
  return game.yourMove ? 'Your move' : `Waiting on ${opponentOf(game).name}`
}

/**
 * A failed list read throws from `useQuery` during render. Caught here so the
 * screen around it — the wordmark, the account button — stays put, and the
 * failure reads as a failure rather than as an empty list.
 */
class ListErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  render() {
    if (this.state.failed) {
      return (
        <p role="alert" className="text-sm text-chalk">
          Couldn’t load your games. Reload to try again.
        </p>
      )
    }
    return this.props.children
  }
}
