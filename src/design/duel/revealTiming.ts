import type { RevealScenario } from './scenario'

/**
 * The reveal's choreography, as times rather than as animation.
 *
 * Every beat is computed in "story seconds" — the original tempo the sequence was
 * designed at — and then multiplied out by {@link REVEAL_TEMPO} at the boundary.
 * Slowing the reveal is therefore one number, and it cannot slow one beat while
 * leaving another at its old duration.
 */

/** How much slower than the original choreography the reveal plays. Testers found
 * the first pass read fast; 1.5x is the pace chosen from that feedback. */
export const REVEAL_TEMPO = 1.5

export interface RevealBeats {
  /** The outcome word lands. */
  outcomeAt: number
  /** The drama chip snaps in under it. */
  calloutAt: number
  /** The park fades up. */
  fieldAt: number
  /** The ball leaves the bat. */
  ballAt: number
  /** The runners step off. */
  runnersAt: number
  /** The scoreboard ticks the runs, once the last one has actually crossed. */
  runTickAt: number
  /** The scoreline settles under the field. */
  scorelineAt: number
}

/** Every beat of the reveal, already scaled to the played tempo. */
export function revealBeats(_scenario: RevealScenario, _tempo: number = REVEAL_TEMPO): RevealBeats {
  throw new Error('not implemented')
}
