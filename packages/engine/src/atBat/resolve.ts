import type { CellDiffs } from '../harness/types'
import type { OutcomeBandKey } from '../outcomes'
import type { BaseState, OutcomeApplication } from './advance'

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
export function deriveDiffs(_hitter: HitterAttributes, _pitcher: PitcherAttributes): CellDiffs {
  throw new Error('not implemented')
}

/** Fold, classify, and apply — the authoritative single-at-bat resolution. */
export function resolveAtBat(_input: ResolveInput): ResolvedAtBat {
  throw new Error('not implemented')
}
