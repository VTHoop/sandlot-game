import type { AttributeDiff, OutcomeTable } from './seedTables'
import {
  BB,
  DOUBLE,
  FO,
  HAND_OPPOSITE,
  HAND_SAME,
  HIT_TOTAL,
  HR,
  IF1B,
  K,
  PO,
  TRIPLE,
} from './seedTables'

export type { AttributeDiff }
export type Handedness = 'same' | 'opposite'

/**
 * Convert a raw number to a validated AttributeDiff.
 * Call this at system boundaries (player input, external data) — all internal
 * engine functions accept AttributeDiff directly.
 */
export function toAttributeDiff(n: number): AttributeDiff {
  return Math.max(-5, Math.min(5, n)) as AttributeDiff
}

function lookup(table: OutcomeTable, diff: AttributeDiff): number {
  return table[diff + 5]
}

export function getHr(powerVelDiff: AttributeDiff): number {
  return lookup(HR, powerVelDiff)
}

export function getTriple(speedAwaDiff: AttributeDiff): number {
  return lookup(TRIPLE, speedAwaDiff)
}

export function getDouble(speedAwaDiff: AttributeDiff): number {
  return lookup(DOUBLE, speedAwaDiff)
}

export function getIf1b(speedAwaDiff: AttributeDiff): number {
  return lookup(IF1B, speedAwaDiff)
}

export function getBb(eyeCmdDiff: AttributeDiff): number {
  return lookup(BB, eyeCmdDiff)
}

export function getHitTotal(contactMovDiff: AttributeDiff): number {
  return lookup(HIT_TOTAL, contactMovDiff)
}

export function getK(contactMovDiff: AttributeDiff): number {
  return lookup(K, contactMovDiff)
}

export function getFo(powerVelDiff: AttributeDiff): number {
  return lookup(FO, powerVelDiff)
}

export function getPo(powerVelDiff: AttributeDiff): number {
  return lookup(PO, powerVelDiff)
}

export interface SingleDiffs {
  contactMov: AttributeDiff
  powerVel: AttributeDiff
  speedAwa: AttributeDiff
}

/** 1B is derived: hit-total minus the carved-out extra-base hits and IF1B. */
export function getSingle({ contactMov, powerVel, speedAwa }: SingleDiffs): number {
  return Math.max(
    0,
    getHitTotal(contactMov) -
      getHr(powerVel) -
      getTriple(speedAwa) -
      getDouble(speedAwa) -
      getIf1b(speedAwa),
  )
}

export function getHandSwitcher(handedness: Handedness, contactMovDiff: AttributeDiff): number {
  return lookup(handedness === 'same' ? HAND_SAME : HAND_OPPOSITE, contactMovDiff)
}
