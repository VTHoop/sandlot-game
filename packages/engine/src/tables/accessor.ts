import type { OutcomeTable } from './seedTables'
import { BB, DOUBLE, HAND_OPPOSITE, HAND_SAME, HIT_TOTAL, HR, IF1B, K, TRIPLE } from './seedTables'

export type Handedness = 'same' | 'opposite'

function clamp(diff: number): number {
  return Math.max(-5, Math.min(5, diff))
}

function lookup(table: OutcomeTable, diff: number): number {
  return table[clamp(diff) + 5]
}

export function getHr(powerVelDiff: number): number {
  return lookup(HR, powerVelDiff)
}

export function getTriple(speedAwaDiff: number): number {
  return lookup(TRIPLE, speedAwaDiff)
}

export function getDouble(speedAwaDiff: number): number {
  return lookup(DOUBLE, speedAwaDiff)
}

export function getIf1b(speedAwaDiff: number): number {
  return lookup(IF1B, speedAwaDiff)
}

export function getBb(eyeCmdDiff: number): number {
  return lookup(BB, eyeCmdDiff)
}

export function getHitTotal(contactMovDiff: number): number {
  return lookup(HIT_TOTAL, contactMovDiff)
}

export function getK(contactMovDiff: number): number {
  return lookup(K, contactMovDiff)
}

export interface SingleDiffs {
  contactMov: number
  powerVel: number
  speedAwa: number
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

export function getHandSwitcher(handedness: Handedness, contactMovDiff: number): number {
  return lookup(handedness === 'same' ? HAND_SAME : HAND_OPPOSITE, contactMovDiff)
}
