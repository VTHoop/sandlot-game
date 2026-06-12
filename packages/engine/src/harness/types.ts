import type { AttributeDiff } from '../tables/accessor'

export interface CellDiffs {
  powerVel: AttributeDiff
  speedAwa: AttributeDiff
  eyeCmd: AttributeDiff
  contactMov: AttributeDiff
}

export interface SlashLine {
  /** H / AB */
  avg: number
  /** (H + BB) / PA */
  obp: number
  /** total_bases / AB */
  slg: number
  /** HR / PA */
  hrPct: number
  /** K / PA */
  kPct: number
  /** BB / PA */
  bbPct: number
}

export interface OutcomeRates {
  hr: number
  triple: number
  double: number
  single: number
  if1b: number
  bb: number
  fo: number
  po: number
  gb: number
  k: number
}

export interface RunValues {
  hr: number
  triple: number
  double: number
  single: number
  if1b: number
  bb: number
  fo: number
  po: number
  gb: number
  k: number
}

export interface CellResult {
  diffs: CellDiffs
  rates: OutcomeRates
  slashLine: SlashLine
  runsPerGame: number
}

/** Returns a non-negative weight for a cell; zero-weight cells are excluded from aggregation. */
export type DifferentialWeightFn = (diffs: CellDiffs) => number

export interface GridArtifact {
  cells: CellResult[]
  linearWeights: RunValues
}

export type StatKey = 'avg' | 'obp' | 'slg' | 'hrPct' | 'kPct' | 'bbPct'

export interface BaselineConfig {
  avg: number
  obp: number
  slg: number
  hrPct: number
  kPct: number
  bbPct: number
}

export interface ToleranceConfig {
  avg: number
  obp: number
  slg: number
  hrPct: number
  kPct: number
  bbPct: number
}

export interface StatDelta {
  actual: number
  baseline: number
  delta: number
  pass: boolean
}

export interface AssertionResult {
  pass: boolean
  perStatDeltas: Record<StatKey, StatDelta>
}
