import type { GameContext } from '@sandlot/engine/game'
import { useCallback, useEffect, useRef, useState } from 'react'
import { createDuelAdapter, deriveMatchup } from './adapter'
import { createBotAgent } from './botAgent'
import { type HalfSummary, playHalfInning, type RevealGate, type SeatAgents } from './duelLoop'
import type { DuelMatchup } from './MatchupCard'
import type { Roster } from './roster'
import type { DuelSituation, RevealScenario } from './scenario'
import { DuelSeat, type SeatAgent, SeatKind, type SeatKinds } from './seatAgent'

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

/** Whether every seat is filled by a bot — the case with no human present, so the
 * half must run to completion without a human to enter numbers or advance reveals. */
function isFullyAutomated(seats: SeatKinds): boolean {
  return seats[DuelSeat.Pitcher] === SeatKind.Bot && seats[DuelSeat.Batter] === SeatKind.Bot
}

/**
 * Drive one half-inning from live game state (SAN-47, SAN-48). The pure loop
 * (`playHalfInning`) owns the sequencing and the secret pitch; this hook supplies
 * the two seams. A HUMAN seat is a `SeatAgent` whose `requestNumber` parks a
 * resolver and shows the commit screen; a BOT seat is `createBotAgent`, which
 * resolves its number itself with no screen. A `RevealGate` parks for a human to
 * advance, unless the half is bot-vs-bot — then it advances itself so the inning
 * plays to completion with no human input (SAN-48).
 *
 * The pitch never enters React state: it lives solely in the loop's local and the
 * adapter it resolves through. A commit view is fed only `situation` (which
 * structurally excludes both duel numbers) plus `opponentLocked`.
 */
export function useDuelPlay(
  roster: Roster,
  context: GameContext,
  seats: SeatKinds,
): DuelPlayController {
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
    const automated = isFullyAutomated(seats)

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
    // A bot resolves its own number (no commit screen); a human parks on the screen.
    const bots: SeatAgents = {
      [DuelSeat.Pitcher]: createBotAgent(),
      [DuelSeat.Batter]: createBotAgent(),
    }
    const agentFor = (seat: DuelSeat): SeatAgent =>
      seats[seat] === SeatKind.Bot ? bots[seat] : humanSeat
    // Bot-vs-bot has no human to advance: the gate resolves at once so the loop runs
    // straight through to the summary. With a human present it parks on each reveal.
    // The automated loop only ever awaits already-resolved promises (a bot's number
    // and this gate), so it never suspends across a macrotask — it completes within
    // this effect's own tick, before any user-triggered unmount can interleave. It is
    // therefore never "parked" at unmount; the `active` gate below is what neutralizes
    // it (any late setView is a no-op). See the cleanup note.
    const gate: RevealGate = automated
      ? { present: async () => {} }
      : {
          present: (scenario, isFinalOfHalf) =>
            new Promise<void>((resolve, reject) => {
              revealResolver.current = resolve
              cancelParked.current = reject
              show({ kind: PlayViewKind.Reveal, scenario, isFinalOfHalf })
            }),
        }
    const agents: SeatAgents = {
      [DuelSeat.Pitcher]: agentFor(DuelSeat.Pitcher),
      [DuelSeat.Batter]: agentFor(DuelSeat.Batter),
    }
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
      // A human loop parks on a commit/reveal promise: reject it so the awaiting loop
      // unwinds and releases its adapter/roster/context closures rather than parking
      // forever. A bot-vs-bot loop is never parked (it has already run to completion
      // within the effect tick — see the gate note), so `cancelParked` is null and the
      // `active = false` above is what makes it a no-op; both paths are covered.
      cancelParked.current?.(new Error('half-inning unmounted'))
      cancelParked.current = null
      numberResolver.current = null
      revealResolver.current = null
    }
  }, [roster, context, seats])

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
