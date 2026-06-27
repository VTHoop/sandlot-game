export type { BaseState, OutcomeApplication, RunnerId } from './advance'
export { applyOutcome, EMPTY_BASES } from './advance'
export { BuntResult } from './bunt/result'
export { classifyOutcome } from './classify'
export { DUEL_MAX, DUEL_MIN, foldDifference, isDuelNumber } from './fold'
export { GroundBallResult } from './groundBall/result'
export type {
  BaseSpeeds,
  HitterAttributes,
  PitcherAttributes,
  ResolvedAtBat,
  ResolveInput,
} from './resolve'
export { deriveDiffs, resolveAtBat } from './resolve'
export { SwingType } from './swingType'
