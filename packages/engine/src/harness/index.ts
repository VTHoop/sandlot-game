export { computeCell } from './computeCell'
export { defaultDifferentialWeight } from './defaultDistribution'
export { ARTIFACT_PATH, emitArtifact, printAggregateSummary } from './emit'
export type { EnumerationResult } from './grid'
export {
  aggregateGrid,
  assertAggregate,
  buildArtifact,
  enumerateGrid,
  validateEnumeration,
  validateGridInvariants,
} from './grid'
export { DEFAULT_LINEAR_WEIGHTS, OUTS_PER_GAME } from './linearWeights'
export type {
  AssertionResult,
  BaselineConfig,
  CellDiffs,
  CellResult,
  DifferentialWeightFn,
  GridArtifact,
  OutcomeRates,
  RunValues,
  SlashLine,
  StatDelta,
  StatKey,
  ToleranceConfig,
} from './types'
