import type { OutcomeBandKey } from '../outcomes'

/** Base occupancy snapshot. */
export interface BaseState {
  first: boolean
  second: boolean
  third: boolean
}

/** The post-state an outcome produces from the pre-state. */
export interface OutcomeApplication {
  runsScored: number
  rbi: number
  basesAfter: BaseState
  outsAfter: number
}

/** The runner movement an outcome produces, before folding in the pre-state outs. */
interface Advance {
  runsScored: number
  basesAfter: BaseState
  outsDelta: number
}

type AdvanceFn = (bases: BaseState) => Advance

const occupied = (b: BaseState): number =>
  (b.first ? 1 : 0) + (b.second ? 1 : 0) + (b.third ? 1 : 0)

const homeRun: AdvanceFn = (b) => ({
  runsScored: occupied(b) + 1,
  basesAfter: { first: false, second: false, third: false },
  outsDelta: 0,
})

const triple: AdvanceFn = (b) => ({
  runsScored: occupied(b),
  basesAfter: { first: false, second: false, third: true },
  outsDelta: 0,
})

const double: AdvanceFn = (b) => ({
  runsScored: (b.second ? 1 : 0) + (b.third ? 1 : 0),
  basesAfter: { first: false, second: true, third: b.first },
  outsDelta: 0,
})

// 1B and IF1B: every runner advances exactly one base, batter to first.
const single: AdvanceFn = (b) => ({
  runsScored: b.third ? 1 : 0,
  basesAfter: { first: true, second: b.first, third: b.second },
  outsDelta: 0,
})

// Batter takes first; only forced runners move, so a run scores only when loaded.
const walk: AdvanceFn = (b) => {
  if (!b.first) return { runsScored: 0, basesAfter: { ...b, first: true }, outsDelta: 0 }
  if (!b.second)
    return { runsScored: 0, basesAfter: { ...b, first: true, second: true }, outsDelta: 0 }
  if (!b.third)
    return { runsScored: 0, basesAfter: { first: true, second: true, third: true }, outsDelta: 0 }
  return { runsScored: 1, basesAfter: { first: true, second: true, third: true }, outsDelta: 0 }
}

// FO/PO/GB/K: one out, no runner movement (GB sub-resolution + tag-ups deferred).
const fieldOut: AdvanceFn = (b) => ({ runsScored: 0, basesAfter: { ...b }, outsDelta: 1 })

const ADVANCERS = new Map<OutcomeBandKey, AdvanceFn>([
  ['HR', homeRun],
  ['3B', triple],
  ['2B', double],
  ['1B', single],
  ['IF1B', single],
  ['BB', walk],
  ['FO', fieldOut],
  ['PO', fieldOut],
  ['GB', fieldOut],
  ['K', fieldOut],
])

/**
 * Apply a resolved outcome to the base/out state (standard one-base advancement,
 * ADR-0016). `rbi` equals `runsScored` in this model — the deferred mechanics
 * (GB double plays, sac flies, errors) are the only places the two diverge.
 * `outsAfter` is recorded raw and may reach 3; the inning transition belongs to
 * the Game-state-machine ticket. Does not mutate `basesBefore`.
 */
export function applyOutcome(
  outcome: OutcomeBandKey,
  basesBefore: BaseState,
  outsBefore: number,
): OutcomeApplication {
  const advance = ADVANCERS.get(outcome)
  if (!advance) throw new RangeError(`unknown outcome ${outcome}`)
  const { runsScored, basesAfter, outsDelta } = advance(basesBefore)
  return { runsScored, rbi: runsScored, basesAfter, outsAfter: outsBefore + outsDelta }
}
