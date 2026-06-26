import type { CellDiffs } from '../harness/types'
import type { OutcomeBandKey } from '../outcomes'
import { toAttributeDiff } from '../tables/accessor'
import { applyOutcome, type BaseState, type OutcomeApplication, type RunnerId } from './advance'
import { classify } from './classify'
import { foldDifference } from './fold'
import { resolveGroundBall } from './groundBall/resolve'
import type { GroundBallResult } from './groundBall/result'

/** Hitter 1–5 attribute block (Convex-free; the caller maps its own shape onto this). */
export interface HitterAttributes {
  power: number
  contact: number
  speed: number
  eye: number
}

/** Pitcher 1–5 attribute block — the defensive counterpart. */
export interface PitcherAttributes {
  velocity: number
  movement: number
  awareness: number
  command: number
}

/**
 * Each on-base runner's 1–5 speed, looked up at the boundary (null where empty),
 * positionally aligned to `basesBefore`. The engine stays roster-free (ADR-0009):
 * the caller resolves ids → speed (a pitcher-as-runner defaults to 1, SAN-16) and
 * passes this block; the engine never holds a roster handle. Consumed only by the
 * GB sub-resolution's speed axis.
 */
export interface BaseSpeeds {
  first: number | null
  second: number | null
  third: number | null
}

export interface ResolveInput {
  pitch: number
  swing: number
  hitter: HitterAttributes
  pitcher: PitcherAttributes
  basesBefore: BaseState
  outsBefore: number
  /** The batter's opaque id, seated on base when the outcome reaches base (SAN-44). */
  batter: RunnerId
  /** On-base runner speeds for the GB sub-resolution speed axis (SAN-16). */
  runnerSpeeds: BaseSpeeds
}

export interface ResolvedAtBat extends OutcomeApplication {
  difference: number
  outcome: OutcomeBandKey
  /** The GB sub-result when `outcome === 'GB'`, else null (SAN-16). */
  groundBallResult: GroundBallResult | null
}

/** Clamp bounds for the speed − awareness axis (avg speed 1–5 vs awareness 1–5). */
const SPEED_AXIS_MIN = -4
const SPEED_AXIS_MAX = 4

/**
 * The GB speed axis: the batter's speed (beating the throw to first) averaged with
 * every on-base runner's speed (beating the force), netted against the pitcher's
 * awareness. Faster nets convert force double plays into fielder's choices.
 */
function groundBallSpeedDiff(
  batterSpeed: number,
  awareness: number,
  runnerSpeeds: BaseSpeeds,
): number {
  const speeds = [batterSpeed, runnerSpeeds.first, runnerSpeeds.second, runnerSpeeds.third].filter(
    (s): s is number => s !== null,
  )
  const avg = speeds.reduce((sum, s) => sum + s, 0) / speeds.length
  return Math.max(SPEED_AXIS_MIN, Math.min(SPEED_AXIS_MAX, avg - awareness))
}

/** Derive the four batter − pitcher attribute differentials, clamped to [−5, +5]. */
export function deriveDiffs(hitter: HitterAttributes, pitcher: PitcherAttributes): CellDiffs {
  return {
    powerVel: toAttributeDiff(hitter.power - pitcher.velocity),
    contactMov: toAttributeDiff(hitter.contact - pitcher.movement),
    speedAwa: toAttributeDiff(hitter.speed - pitcher.awareness),
    eyeCmd: toAttributeDiff(hitter.eye - pitcher.command),
  }
}

/**
 * Fold, classify, and apply — the authoritative single-at-bat resolution shared
 * by the Convex server (the vault) and the read-only client preview (ADR-0009).
 */
export function resolveAtBat(input: ResolveInput): ResolvedAtBat {
  const difference = foldDifference(input.pitch, input.swing)
  const { outcome, gbBand } = classify(difference, deriveDiffs(input.hitter, input.pitcher))

  // The GB band sub-resolves into a fielder's-choice / double-play / etc. family
  // (SAN-16, the seam applyOutcome leaves deferred); every other band applies the
  // standard one-base advancement directly.
  if (outcome === 'GB') {
    const speedDiff = groundBallSpeedDiff(
      input.hitter.speed,
      input.pitcher.awareness,
      input.runnerSpeeds,
    )
    const gb = resolveGroundBall({
      difference,
      gbBand,
      basesBefore: input.basesBefore,
      outsBefore: input.outsBefore,
      batter: input.batter,
      speedDiff,
    })
    return {
      difference,
      outcome,
      groundBallResult: gb.result,
      runsScored: gb.runsScored,
      rbi: gb.rbi,
      basesAfter: gb.basesAfter,
      outsAfter: gb.outsAfter,
    }
  }

  const application = applyOutcome(outcome, input.basesBefore, input.outsBefore, input.batter)
  return { difference, outcome, groundBallResult: null, ...application }
}
