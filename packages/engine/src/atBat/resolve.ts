import type { CellDiffs } from '../harness/types'
import type { OutcomeBandKey } from '../outcomes'
import type { Band } from '../rangeFinder/frontHalf'
import { toAttributeDiff } from '../tables/accessor'
import {
  advanceInfieldSingle,
  applyOutcome,
  type BaseState,
  type OutcomeApplication,
  type RunnerId,
} from './advance'
import { resolveFlyOut } from './advancement/deepFly'
import { resolveExtraBase } from './advancement/extraBase'
import { resolveBunt } from './bunt/resolve'
import { BuntResult } from './bunt/result'
import { classify } from './classify'
import { foldDifference } from './fold'
import { resolveGroundBall } from './groundBall/resolve'
import type { GroundBallResult } from './groundBall/result'
import { SwingType } from './swingType'

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
 * passes this block; the engine never holds a roster handle. Consumed by the GB
 * sub-resolution's speed axis (SAN-16) and the extra-base ranges (SAN-17).
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
  /** On-base runner speeds for the GB speed axis (SAN-16) and extra-base ranges (SAN-17). */
  runnerSpeeds: BaseSpeeds
  /** The swing declaration; defaults to a normal swing when omitted (SAN-17). */
  swingType?: SwingType
}

export interface ResolvedAtBat extends OutcomeApplication {
  difference: number
  outcome: OutcomeBandKey
  /** The GB sub-result when `outcome === 'GB'`, else null (SAN-16). */
  groundBallResult: GroundBallResult | null
  /** The bunt sub-result when `swingType === Bunt`, else null (SAN-17). */
  buntResult: BuntResult | null
}

/**
 * Map a bunt sub-result onto a representative persisted outcome band (SAN-17,
 * ADR-0021): a bunt bypasses the RangeFinder, so it has no native band. Bunt-hit
 * and butcher-boy reach base like a single (`1B`); a successful sacrifice is a
 * productive out (`FO`); a dud / DP / TP is an unproductive out (`GB`). The finer
 * `buntResult` carries the real detail. A Map keeps the lookup off the
 * object-injection sink.
 */
const BUNT_OUTCOME_BAND = new Map<BuntResult, OutcomeBandKey>([
  [BuntResult.BUNT_HIT, '1B'],
  [BuntResult.BUTCHER_BOY, '1B'],
  [BuntResult.SAC_2ND, 'FO'],
  [BuntResult.SAC_3RD, 'FO'],
  [BuntResult.SAC_HOME, 'FO'],
  [BuntResult.DUD, 'GB'],
  [BuntResult.DP, 'GB'],
  [BuntResult.TP, 'GB'],
])

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
 * Apply a non-GB outcome's runner movement. The IF1B / FO / 1B / 2B bands route
 * through the SAN-17 advancement sub-resolutions (forced/2-out infield single
 * §3.3, deep-fly/sac-fly §3.2.6.1, extra-base §3.2); every other band applies the
 * standard one-base advancement (ADR-0016). The matched `band` and folded
 * `difference` size the deterministic width ranges; runner speeds and hitter power
 * arrive as caller-supplied inputs (ADR-0009).
 */
function resolveAdvancement(
  outcome: OutcomeBandKey,
  difference: number,
  band: Band,
  input: ResolveInput,
): OutcomeApplication {
  const { basesBefore, outsBefore, batter, runnerSpeeds, hitter } = input
  switch (outcome) {
    case 'IF1B':
      return advanceInfieldSingle(basesBefore, outsBefore, batter)
    case 'FO':
      return resolveFlyOut({
        difference,
        band,
        bases: basesBefore,
        outsBefore,
        power: hitter.power,
        speeds: runnerSpeeds,
      })
    case '1B':
    case '2B':
      return resolveExtraBase({
        outcome,
        difference,
        band,
        bases: basesBefore,
        outsBefore,
        batter,
        speeds: runnerSpeeds,
      })
    default:
      return applyOutcome(outcome, basesBefore, outsBefore, batter)
  }
}

/**
 * Fold, classify, and apply — the authoritative single-at-bat resolution shared
 * by the Convex server (the vault) and the read-only client preview (ADR-0009).
 */
export function resolveAtBat(input: ResolveInput): ResolvedAtBat {
  const difference = foldDifference(input.pitch, input.swing)
  const diffs = deriveDiffs(input.hitter, input.pitcher)

  // A bunt bypasses the RangeFinder entirely: its outcome family emerges from the
  // folded difference + base state in the bunt sub-resolution (SAN-17, §3.4).
  if (input.swingType === SwingType.Bunt) {
    const bunt = resolveBunt({
      difference,
      basesBefore: input.basesBefore,
      outsBefore: input.outsBefore,
      batter: input.batter,
      contactMovDiff: diffs.contactMov,
      speedAwaDiff: diffs.speedAwa,
    })
    const outcome = BUNT_OUTCOME_BAND.get(bunt.result)
    if (!outcome) throw new RangeError(`unmapped bunt result ${bunt.result}`)
    return {
      difference,
      outcome,
      groundBallResult: null,
      buntResult: bunt.result,
      runsScored: bunt.runsScored,
      rbi: bunt.rbi,
      basesAfter: bunt.basesAfter,
      outsAfter: bunt.outsAfter,
    }
  }

  const { outcome, band, gbBand } = classify(difference, diffs)

  // The GB band sub-resolves into a fielder's-choice / double-play / etc. family
  // (SAN-16, the seam applyOutcome leaves deferred); every other band routes
  // through resolveAdvancement.
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
      buntResult: null,
      runsScored: gb.runsScored,
      rbi: gb.rbi,
      basesAfter: gb.basesAfter,
      outsAfter: gb.outsAfter,
    }
  }

  const application = resolveAdvancement(outcome, difference, band, input)
  return { difference, outcome, groundBallResult: null, buntResult: null, ...application }
}
