import type { DuelAdapter } from './adapter'
import type { Roster } from './roster'
import type { RevealScenario } from './scenario'
import type { DuelSeat, SeatAgent } from './seatAgent'

/** A completed half-inning, reduced to the two numbers the summary shows. */
export interface HalfSummary {
  half: 'TOP' | 'BOTTOM'
  inning: number
  /** Runs the batting side scored this half. */
  runs: number
  /** Hits the batting side collected this half. */
  hits: number
}

/**
 * The reveal gate: the loop hands each resolved at-bat to the presenter and waits
 * for the "advance" before seating the next batter. `isFinalOfHalf` is true only
 * for the at-bat whose third out ends the half, so the UI can label the advance
 * as the end-of-half hand-off rather than "next batter".
 */
export interface RevealGate {
  present(reveal: RevealScenario, isFinalOfHalf: boolean): Promise<void>
}

/** Both seats' agents for a hotseat half-inning (one human fills both). */
export type SeatAgents = Record<DuelSeat, SeatAgent>

// TODO(SAN-47): implemented in the green commit.
export async function playHalfInning(
  _adapter: DuelAdapter,
  _roster: Roster,
  _agents: SeatAgents,
  _gate: RevealGate,
): Promise<HalfSummary> {
  throw new Error('SAN-47 playHalfInning not implemented')
}
