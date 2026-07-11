import type { GameContext } from '@sandlot/engine/game'
import { useCallback, useEffect, useRef, useState } from 'react'
import { createDuelAdapter, deriveMatchup } from './adapter'
import { type HalfSummary, playHalfInning, type RevealGate, type SeatAgents } from './duelLoop'
import type { DuelMatchup } from './MatchupCard'
import type { Roster } from './roster'
import type { DuelSituation, RevealScenario } from './scenario'
import { DuelSeat, type SeatAgent } from './seatAgent'

/** The kind of screen the container is currently showing — the discriminant of
 * {@link PlayView}. An enum (not a literal union) per the project's finite-value-set
 * convention; this is internal view state, not a Convex schema boundary. */
export enum PlayViewKind {
  Commit = 'commit',
  Reveal = 'reveal',
  Summary = 'summary',
  Error = 'error',
}

/** What the container is currently showing — the projection the loop drives. */
export type PlayView =
  | {
      kind: PlayViewKind.Commit
      seat: DuelSeat
      situation: DuelSituation
      matchup: DuelMatchup
      /** Whether the opposing seat has already locked (never the number). */
      opponentLocked: boolean
    }
  | { kind: PlayViewKind.Reveal; scenario: RevealScenario; isFinalOfHalf: boolean }
  | { kind: PlayViewKind.Summary; summary: HalfSummary }
  | { kind: PlayViewKind.Error; message: string }

interface DuelPlayController {
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
  // Rejects whichever commit/reveal promise is currently parked, so an unmount can
  // unwind the awaiting loop instead of leaking it (see the cleanup below).
  const cancelParked = useRef<((reason: unknown) => void) | null>(null)

  useEffect(() => {
    // This effect owns one loop run. `active` gates every setView so a resolution
    // that lands after unmount is a no-op; the cleanup unwinds the parked loop.
    let active = true
    const show = (next: PlayView) => {
      if (active) setView(next)
    }
    const adapter = createDuelAdapter(roster, context)

    const humanSeat: SeatAgent = {
      requestNumber: ({ seat, situation }) =>
        new Promise<number>((resolve, reject) => {
          numberResolver.current = resolve
          cancelParked.current = reject
          show({
            kind: PlayViewKind.Commit,
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
        new Promise<void>((resolve, reject) => {
          revealResolver.current = resolve
          cancelParked.current = reject
          show({ kind: PlayViewKind.Reveal, scenario, isFinalOfHalf })
        }),
    }
    const agents: SeatAgents = { [DuelSeat.Pitcher]: humanSeat, [DuelSeat.Batter]: humanSeat }
    playHalfInning(adapter, roster, agents, gate)
      .then((summary) => {
        show({ kind: PlayViewKind.Summary, summary })
      })
      .catch((error: unknown) => {
        // A real failure surfaces; an unmount cancellation is swallowed by `show`
        // (active === false), so it never flashes an error view on the way out.
        show({
          kind: PlayViewKind.Error,
          message: error instanceof Error ? error.message : 'The half-inning could not continue.',
        })
      })

    return () => {
      active = false
      // Reject the parked commit/reveal promise so the awaiting loop unwinds and
      // releases its adapter/roster/context closures rather than parking forever.
      cancelParked.current?.(new Error('half-inning unmounted'))
      cancelParked.current = null
      numberResolver.current = null
      revealResolver.current = null
    }
  }, [roster, context])

  const submitNumber = useCallback((n: number) => {
    const resolve = numberResolver.current
    numberResolver.current = null
    cancelParked.current = null
    resolve?.(n)
  }, [])
  const advanceReveal = useCallback(() => {
    const resolve = revealResolver.current
    revealResolver.current = null
    cancelParked.current = null
    resolve?.()
  }, [])

  return { view, submitNumber, advanceReveal }
}
