import type { CellDiffs } from '../harness/types'
import type { OutcomeBandKey } from '../outcomes'
import { assembleBackHalf } from '../rangeFinder/backHalf'
import type { Band } from '../rangeFinder/frontHalf'
import { assembleFrontHalf } from '../rangeFinder/frontHalf'

/**
 * Map a folded 0–499 difference onto the assembled band stack and return the
 * outcome whose `[lo, hi]` window contains it.
 *
 * The bands are assembled fresh from the four differentials (front half HR→BB,
 * then the elastic back half FO→K seeded at `BB.hi + 1`). The pairs are listed
 * explicitly in best→worst order — matching {@link OUTCOME_BAND_KEYS} — so the
 * lookup carries no dynamic object-member access (object-injection sink).
 */
export function classifyOutcome(difference: number, diffs: CellDiffs): OutcomeBandKey {
  const front = assembleFrontHalf(diffs)
  const back = assembleBackHalf(
    { powerVel: diffs.powerVel, contactMov: diffs.contactMov },
    front.BB.hi + 1,
  )
  const stack: ReadonlyArray<readonly [OutcomeBandKey, Band]> = [
    ['HR', front.HR],
    ['3B', front['3B']],
    ['2B', front['2B']],
    ['1B', front['1B']],
    ['IF1B', front.IF1B],
    ['BB', front.BB],
    ['FO', back.FO],
    ['PO', back.PO],
    ['GB', back.GB],
    ['K', back.K],
  ]
  for (const [key, band] of stack) {
    if (difference >= band.lo && difference <= band.hi) return key
  }
  throw new RangeError(`difference ${difference} is outside the assembled 0–499 band range`)
}
