import type { BaseState, RunnerId } from '../advance'
import { BuntResult } from './result'

/** Runner movement a bunt sub-result produces, before third-out run suppression. */
export interface BuntAdvance {
  runsScored: number
  outsDelta: number
  basesAfter: BaseState
}

const scored = (runner: RunnerId | null): number => (runner ? 1 : 0)

/**
 * Bunt double play: the lead forced runner and the batter are both out (+2);
 * trailing forced runners advance into the vacated bases. The same force model as
 * the GB double play (Rules §2.13) — a bunt DP needs a runner on 1st to force.
 * The batter is out, so never seated.
 */
function doublePlay(b: BaseState): BaseState {
  if (b.second && b.third) return { first: null, second: b.first, third: b.second } // lead out at home
  if (b.second) return { first: null, second: b.first, third: null } // lead out at 3rd, 1st→2nd
  if (b.third) return { first: null, second: null, third: b.third } // lead out at 2nd, 3rd holds
  return { first: null, second: null, third: null } // lead out at 2nd, bases otherwise empty
}

/** Successful sacrifice: every runner advances one base, the batter is out (+1). The
 * SAC_2ND/3RD/HOME label is which base the lead runner reaches; the movement is
 * identical (and a run scores from 3rd). */
const sacrifice = (b: BaseState): BuntAdvance => ({
  runsScored: scored(b.third),
  outsDelta: 1,
  basesAfter: { first: null, second: b.first, third: b.second },
})

type BuntMovement = (bases: BaseState, batter: RunnerId) => BuntAdvance

// Keyed by a Map (not a plain object) so the dynamic lookup stays off the
// object-injection sink — the same discipline as the GB advancers.
const MOVEMENT = new Map<BuntResult, BuntMovement>([
  [
    BuntResult.TP,
    () => ({ runsScored: 0, outsDelta: 3, basesAfter: { first: null, second: null, third: null } }),
  ],
  [BuntResult.DP, (b) => ({ runsScored: 0, outsDelta: 2, basesAfter: doublePlay(b) })],
  // Butcher boy: batter awarded a single AND every runner advances an extra base
  // (= a well-hit single): 3rd & 2nd score, 1st→3rd, batter to first (§3.4.2).
  [
    BuntResult.BUTCHER_BOY,
    (b, batter) => ({
      runsScored: scored(b.third) + scored(b.second),
      outsDelta: 0,
      basesAfter: { first: batter, second: null, third: b.first },
    }),
  ],
  [BuntResult.SAC_2ND, sacrifice],
  [BuntResult.SAC_3RD, sacrifice],
  [BuntResult.SAC_HOME, sacrifice],
  // Bunt for a hit: batter safe at first, runners advance one base (a single).
  [
    BuntResult.BUNT_HIT,
    (b, batter) => ({
      runsScored: scored(b.third),
      outsDelta: 0,
      basesAfter: { first: batter, second: b.first, third: b.second },
    }),
  ],
  // Failed bunt: batter out, no runner advances.
  [BuntResult.DUD, (b) => ({ runsScored: 0, outsDelta: 1, basesAfter: { ...b } })],
])

/**
 * Apply a bunt sub-result's runner movement. Pure and out-count-agnostic: the
 * caller folds in `outsBefore` and suppresses runs on an inning-ending out.
 */
export function advanceBunt(result: BuntResult, bases: BaseState, batter: RunnerId): BuntAdvance {
  const move = MOVEMENT.get(result)
  if (!move) throw new RangeError(`unknown bunt result ${result}`)
  return move(bases, batter)
}
