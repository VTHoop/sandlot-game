import type { GameContext } from '@sandlot/engine/game'
import type { HalfSummary } from './duelLoop'
import type { DuelMatchup } from './MatchupCard'
import type { Roster } from './roster'
import type { DuelSituation, RevealScenario } from './scenario'
import type { DuelSeat } from './seatAgent'

/** What the container is currently showing — the projection the loop drives. */
export type PlayView =
  | {
      kind: 'commit'
      seat: DuelSeat
      situation: DuelSituation
      matchup: DuelMatchup
      /** Whether the opposing seat has already locked (never the number). */
      opponentLocked: boolean
    }
  | { kind: 'reveal'; scenario: RevealScenario; isFinalOfHalf: boolean }
  | { kind: 'summary'; summary: HalfSummary }

export interface DuelPlayController {
  view: PlayView | null
  /** The human seat hands its committed number to the waiting loop. */
  submitNumber: (n: number) => void
  /** The human advances past the current reveal. */
  advanceReveal: () => void
}

// TODO(SAN-47): implemented in the green commit.
export function useDuelPlay(_roster: Roster, _context: GameContext): DuelPlayController {
  return { view: null, submitNumber: () => {}, advanceReveal: () => {} }
}
