import type { GameStatus } from '@sandlot/engine/game'
import type { ResolvedAtBatView } from '../../convex/duelContract'
import type { GameView } from '../../convex/gameView'
import type { HalfSummary } from './duelLoop'
import type { DuelMatchup } from './MatchupCard'
import type { DuelSituation, RevealScenario } from './scenario'
import { DuelSeat } from './seatAgent'

/**
 * The server-driven duel's pure half (SAN-39). Declared and stubbed: the red
 * checkpoint has to compile, and the behaviour lands in the green commit.
 */

/** A live game as the read model returns it. */
export type LiveGameView = Extract<GameView, { status: GameStatus.Live }>

export enum TurnKind {
  Commit = 'commit',
  Waiting = 'waiting',
}

export type Turn =
  | { kind: TurnKind.Commit; seat: DuelSeat; opponentLocked: boolean }
  | { kind: TurnKind.Waiting; waitingOn: DuelSeat }

const notYet = (): never => {
  throw new Error('not implemented')
}

export function turnFor(_view: Pick<LiveGameView, 'half' | 'locks' | 'viewerOwns'>): Turn {
  return { kind: TurnKind.Waiting, waitingOn: DuelSeat.Pitcher }
}

export function situationOf(_view: LiveGameView): DuelSituation {
  return notYet()
}

export function matchupOf(_view: LiveGameView): DuelMatchup {
  return notYet()
}

export function revealOf(
  _atBat: ResolvedAtBatView,
  _clubs: Pick<GameView, 'home' | 'away'>,
): RevealScenario {
  return notYet()
}

export function halfSummaryOf(_atBat: ResolvedAtBatView): HalfSummary {
  return notYet()
}
