import type { GameContext } from '@sandlot/engine/game'
import { useCallback, useEffect, useRef, useState } from 'react'
import { createDuelAdapter, deriveMatchup } from './adapter'
import { type HalfSummary, playHalfInning, type RevealGate, type SeatAgents } from './duelLoop'
import type { DuelMatchup } from './MatchupCard'
import type { Roster } from './roster'
import type { DuelSituation, RevealScenario } from './scenario'
import { DuelSeat, type SeatAgent } from './seatAgent'

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

/**
 * Drive one hotseat half-inning from live game state (SAN-47). The pure loop
 * (`playHalfInning`) owns the sequencing and the secret pitch; this hook is only
 * the human seam — a `SeatAgent` whose `requestNumber` parks a resolver and shows
 * the commit screen, and a `RevealGate` that parks a resolver and shows the reveal.
 * A lock or an advance resolves the parked promise, letting the loop step forward.
 *
 * The pitch never enters React state: it lives solely in the loop's local and the
 * adapter it resolves through. The batter's commit view is fed only `situation`
 * (which structurally excludes both duel numbers) plus `opponentLocked`.
 */
export function useDuelPlay(roster: Roster, context: GameContext): DuelPlayController {
  const [view, setView] = useState<PlayView | null>(null)
  const numberResolver = useRef<((n: number) => void) | null>(null)
  const revealResolver = useRef<(() => void) | null>(null)
  const started = useRef(false)

  useEffect(() => {
    if (started.current) return
    started.current = true
    const adapter = createDuelAdapter(roster, context)

    const humanSeat: SeatAgent = {
      requestNumber: ({ seat, situation }) =>
        new Promise<number>((resolve) => {
          numberResolver.current = resolve
          setView({
            kind: 'commit',
            seat,
            situation,
            matchup: deriveMatchup(adapter.state(), roster, context),
            // The pitcher commits first, so the batter's opponent is already locked.
            opponentLocked: seat === DuelSeat.Batter,
          })
        }),
    }
    const gate: RevealGate = {
      present: (scenario, isFinalOfHalf) =>
        new Promise<void>((resolve) => {
          revealResolver.current = resolve
          setView({ kind: 'reveal', scenario, isFinalOfHalf })
        }),
    }
    const agents: SeatAgents = { [DuelSeat.Pitcher]: humanSeat, [DuelSeat.Batter]: humanSeat }
    void playHalfInning(adapter, roster, agents, gate).then((summary) => {
      setView({ kind: 'summary', summary })
    })
  }, [roster, context])

  const submitNumber = useCallback((n: number) => {
    const resolve = numberResolver.current
    numberResolver.current = null
    resolve?.(n)
  }, [])
  const advanceReveal = useCallback(() => {
    const resolve = revealResolver.current
    revealResolver.current = null
    resolve?.()
  }, [])

  return { view, submitNumber, advanceReveal }
}
