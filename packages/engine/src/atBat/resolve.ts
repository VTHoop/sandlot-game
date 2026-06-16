import type { CellDiffs } from '../harness/types'
import type { OutcomeBandKey } from '../outcomes'
import { toAttributeDiff } from '../tables/accessor'
import { applyOutcome, type BaseState, type OutcomeApplication } from './advance'
import { classifyOutcome } from './classify'
import { foldDifference } from './fold'

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

export interface ResolveInput {
  pitch: number
  swing: number
  hitter: HitterAttributes
  pitcher: PitcherAttributes
  basesBefore: BaseState
  outsBefore: number
}

export interface ResolvedAtBat extends OutcomeApplication {
  difference: number
  outcome: OutcomeBandKey
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
  const outcome = classifyOutcome(difference, deriveDiffs(input.hitter, input.pitcher))
  const application = applyOutcome(outcome, input.basesBefore, input.outsBefore)
  return { difference, outcome, ...application }
}
