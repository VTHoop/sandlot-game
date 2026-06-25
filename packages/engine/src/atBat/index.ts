export type { BaseState, OutcomeApplication, RunnerId } from './advance'
export { applyOutcome, EMPTY_BASES } from './advance'
export { classifyOutcome } from './classify'
export { DUEL_MAX, DUEL_MIN, foldDifference, isDuelNumber } from './fold'
export type {
  HitterAttributes,
  PitcherAttributes,
  ResolvedAtBat,
  ResolveInput,
} from './resolve'
export { deriveDiffs, resolveAtBat } from './resolve'
