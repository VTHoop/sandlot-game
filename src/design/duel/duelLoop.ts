import { GameStatus, type LiveGameState } from '@sandlot/engine/game'
import { type DuelAdapter, deriveSituation } from './adapter'
import type { Roster } from './roster'
import { isHit, type RevealScenario } from './scenario'
import { DuelSeat, type SeatAgent } from './seatAgent'

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

const emptyHalfSummary = (): HalfSummary => ({ half: 'TOP', inning: 1, runs: 0, hits: 0 })

/** Fold one reveal into the running half summary (batting side runs + hits). */
function accrueHalf(summary: HalfSummary, reveal: RevealScenario): HalfSummary {
  return {
    half: reveal.half,
    inning: reveal.inning,
    runs: summary.runs + reveal.runsScored,
    hits: summary.hits + (isHit(reveal.outcome) ? 1 : 0),
  }
}

/** Still the same live half-inning we opened on — the loop's continuation guard. */
function sameHalf(state: LiveGameState, start: LiveGameState): boolean {
  return (
    state.status === GameStatus.Live && state.half === start.half && state.inning === start.inning
  )
}

/**
 * A real half-inning ends at the third out, so its at-bat count is small. This cap
 * exists only to keep a non-terminating adapter (a bug — one whose state never
 * flips the half) from hanging the loop; it sits far above any plausible inning.
 */
const MAX_AT_BATS_PER_HALF = 200

/**
 * Play one hotseat half-inning to the third out (SAN-47). Each at-bat: the pitcher
 * seat commits, then the batter seat commits from the SAME non-secret situation —
 * the pitch is a local here and is never passed to the batter agent, so the secret
 * lives only in this loop and the adapter it resolves through. The resolved reveal
 * is handed to the gate; the loop waits for the advance, then the engine's already-
 * folded state seats the next batter. The half ends when the third out flips it.
 *
 * The loop never inspects the concrete `SeatAgent`, so a non-human agent slots into
 * either seat with no change here — only its `requestNumber` differs.
 */
export async function playHalfInning(
  adapter: DuelAdapter,
  roster: Roster,
  agents: SeatAgents,
  gate: RevealGate,
): Promise<HalfSummary> {
  const start = adapter.state()
  let summary = emptyHalfSummary()
  let atBats = 0
  while (sameHalf(adapter.state(), start)) {
    atBats += 1
    if (atBats > MAX_AT_BATS_PER_HALF) {
      throw new Error(`Half-inning exceeded ${MAX_AT_BATS_PER_HALF} at-bats without ending`)
    }
    const situation = deriveSituation(adapter.state(), adapter.hits(), roster)
    const pitch = await agents[DuelSeat.Pitcher].requestNumber({
      seat: DuelSeat.Pitcher,
      situation,
    })
    const swing = await agents[DuelSeat.Batter].requestNumber({ seat: DuelSeat.Batter, situation })
    const { reveal } = adapter.playAtBat(pitch, swing)
    summary = accrueHalf(summary, reveal)
    await gate.present(reveal, !sameHalf(adapter.state(), start))
  }
  return summary
}
