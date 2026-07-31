import { latestScoringArrival } from './fieldMovement'
import { deriveDrama, type RevealScenario } from './scenario'

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
  /** Your score tile flips down. */
  firstFlapAt: number
  /** The opponent's tile follows — the beat the whole sequence is anchored on. */
  secondFlapAt: number
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

/** When the score tiles flip, in story seconds. */
const FIRST_FLAP_AT = 0.3
const SECOND_FLAP_AT = 0.95

/** Gaps between beats, in story seconds. */
const AFTER_FLAP = 0.45
const CALLOUT_GAP = 0.55
const FIELD_GAP = 0.9
const BALL_GAP = 0.35
const RUNNERS_GAP = 0.5
const RUN_TICK_FLOOR = 1.15
const RUN_TICK_SETTLE = 0.15
const SCORELINE_GAP = 0.55

/**
 * Every beat of the reveal, already scaled to the played tempo.
 *
 * The whole sequence is derived at tempo 1 and multiplied once at the end, so
 * slowing the reveal cannot leave a beat behind at its old duration. The run tick
 * is floored rather than fixed: a grand slam's trailing runner is still rounding
 * third long after a routine single's would have scored, and the scoreboard must
 * not add runs while a token is still between bases.
 */
export function revealBeats(scenario: RevealScenario, tempo: number = REVEAL_TEMPO): RevealBeats {
  const outcomeAt = SECOND_FLAP_AT + AFTER_FLAP + deriveDrama(scenario).hold
  const fieldAt = outcomeAt + FIELD_GAP
  const ballAt = fieldAt + BALL_GAP
  const runnersAt = ballAt + RUNNERS_GAP
  const runTickAt = Math.max(
    runnersAt + RUN_TICK_FLOOR,
    latestScoringArrival(scenario.movements, runnersAt) + RUN_TICK_SETTLE,
  )
  const beats: RevealBeats = {
    firstFlapAt: FIRST_FLAP_AT,
    secondFlapAt: SECOND_FLAP_AT,
    outcomeAt,
    calloutAt: outcomeAt + CALLOUT_GAP,
    fieldAt,
    ballAt,
    runnersAt,
    runTickAt,
    scorelineAt: runTickAt + SCORELINE_GAP,
  }
  return Object.fromEntries(
    Object.entries(beats).map(([key, value]) => [key, value * tempo]),
  ) as unknown as RevealBeats
}

/**
 * The same beats with the pre-roll removed — every time re-anchored so the outcome
 * lands at zero. Used for reduced motion: the sequence exists to be *understood*
 * rather than felt, so the held breath before the outcome is dead time. Spacing
 * after the outcome is untouched; only the wait in front of it goes.
 *
 * Beats that ran BEFORE the outcome collapse onto zero rather than going negative:
 * the score tiles are state, not choreography, so with the pre-roll gone they are
 * simply already there. A negative delay would be up to the animation library to
 * interpret, and ordering is not something to leave to that.
 */
export function compressToOutcome(beats: RevealBeats): RevealBeats {
  return Object.fromEntries(
    Object.entries(beats).map(([key, value]) => [key, Math.max(0, value - beats.outcomeAt)]),
  ) as unknown as RevealBeats
}
