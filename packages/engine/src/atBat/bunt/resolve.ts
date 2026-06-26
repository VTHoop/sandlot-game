import type { AttributeDiff } from '../../tables/accessor'
import type { BaseState, RunnerId } from '../advance'
import { advanceBunt } from './advance'
import { type BuntAccessors, liveBuntAccessors, selectBuntResult } from './partition'
import type { BuntResult } from './result'

/** Outs that always end the half-inning, after which no run on the play counts. */
const OUTS_PER_INNING = 3

export interface BuntInput {
  /** The folded 0–499 difference. */
  difference: number
  basesBefore: BaseState
  outsBefore: number
  batter: RunnerId
  /** Cnt-vs-Mov differential — sizes the bunt-for-hit range. */
  contactMovDiff: AttributeDiff
  /** Spe-vs-Awa differential — sizes the successful-sacrifice range. */
  speedAwaDiff: AttributeDiff
}

export interface BuntResolution {
  result: BuntResult
  runsScored: number
  rbi: number
  outsAfter: number
  basesAfter: BaseState
}

/**
 * Resolve a bunt declaration into its sub-result and apply it: select the family
 * the difference lands in (gated by base state + outs), move the runners, fold in
 * the pre-state outs, and suppress runs on an inning-ending out (a sac, DP, or TP
 * that records the third out wipes any run, exactly as the GB sub-resolution does).
 */
export function resolveBunt(
  input: BuntInput,
  accessors: BuntAccessors = liveBuntAccessors,
): BuntResolution {
  const result = selectBuntResult(
    {
      difference: input.difference,
      bases: input.basesBefore,
      outs: input.outsBefore,
      contactMovDiff: input.contactMovDiff,
      speedAwaDiff: input.speedAwaDiff,
    },
    accessors,
  )
  const { runsScored, outsDelta, basesAfter } = advanceBunt(result, input.basesBefore, input.batter)
  const outsAfter = input.outsBefore + outsDelta
  const runs = outsAfter >= OUTS_PER_INNING ? 0 : runsScored
  return { result, runsScored: runs, rbi: runs, outsAfter, basesAfter }
}
