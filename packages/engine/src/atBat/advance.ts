import type { OutcomeBandKey } from '../outcomes'

/**
 * Opaque identifier for the player standing on a base — the same opaque-string
 * convention the engine uses for the batter/pitcher (ADR-0009). The Convex layer
 * maps its `Id<'players'>` onto it at the boundary; the engine never inspects it.
 */
export type RunnerId = string

/** Which runner occupies each base (`null` = empty). Runner-aware so an on-base
 * runner's identity — and thus their stored speed — is reachable (SAN-44). */
export interface BaseState {
  first: RunnerId | null
  second: RunnerId | null
  third: RunnerId | null
}

// Frozen: a single shared, exported value must never become writable process-wide
// state. Every base holds a primitive (null), so a shallow freeze fully protects
// it; advancers build fresh literals rather than handing this reference back.
export const EMPTY_BASES: BaseState = Object.freeze({ first: null, second: null, third: null })

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

/** Advancers move runner ids between bases and seat the batter on reaching base. */
type AdvanceFn = (bases: BaseState, batter: RunnerId) => Advance

const occupied = (b: BaseState): number =>
  (b.first ? 1 : 0) + (b.second ? 1 : 0) + (b.third ? 1 : 0)

const homeRun: AdvanceFn = (b) => ({
  runsScored: occupied(b) + 1,
  basesAfter: { first: null, second: null, third: null },
  outsDelta: 0,
})

const triple: AdvanceFn = (b, batter) => ({
  runsScored: occupied(b),
  basesAfter: { first: null, second: null, third: batter },
  outsDelta: 0,
})

const double: AdvanceFn = (b, batter) => ({
  runsScored: (b.second ? 1 : 0) + (b.third ? 1 : 0),
  basesAfter: { first: null, second: batter, third: b.first },
  outsDelta: 0,
})

// 1B and IF1B: every runner advances exactly one base, batter to first.
const single: AdvanceFn = (b, batter) => ({
  runsScored: b.third ? 1 : 0,
  basesAfter: { first: batter, second: b.first, third: b.second },
  outsDelta: 0,
})

// Batter takes first; only forced runners move. With first & second occupied the
// chain reaches third, so the runner there is forced home (a run) and the others
// each shift up one; otherwise only the contiguous force from first advances.
const walk: AdvanceFn = (b, batter) => {
  if (!b.first) return { runsScored: 0, basesAfter: { ...b, first: batter }, outsDelta: 0 }
  if (!b.second)
    return {
      runsScored: 0,
      basesAfter: { first: batter, second: b.first, third: b.third },
      outsDelta: 0,
    }
  return {
    runsScored: b.third ? 1 : 0,
    basesAfter: { first: batter, second: b.first, third: b.second },
    outsDelta: 0,
  }
}

// FO/PO/GB/K: one out, no runner movement. GB reaches here only as the plain-out
// fallback — resolveAtBat sub-resolves the GB band upstream (SAN-16). Tag-ups
// (sac flies) remain deferred.
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
 * ADR-0016). Runner ids move between bases and the `batter` is seated as a new
 * on-base runner on reaching base; scored runners' ids drop off (derivable from
 * the play, not persisted here). `rbi` equals `runsScored` in this model — the
 * GB sub-resolution (which can suppress runs on a third out) happens upstream in
 * resolveAtBat; the remaining divergences (sac flies, errors) stay deferred.
 * `outsAfter` is recorded raw and may reach 3; the inning transition belongs to
 * the Game-state-machine ticket. Does not mutate `basesBefore`.
 */
export function applyOutcome(
  outcome: OutcomeBandKey,
  basesBefore: BaseState,
  outsBefore: number,
  batter: RunnerId,
): OutcomeApplication {
  const advance = ADVANCERS.get(outcome)
  if (!advance) throw new RangeError(`unknown outcome ${outcome}`)
  const { runsScored, basesAfter, outsDelta } = advance(basesBefore, batter)
  return { runsScored, rbi: runsScored, basesAfter, outsAfter: outsBefore + outsDelta }
}
