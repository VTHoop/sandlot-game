import type { CellDiffs } from '../harness/types'
import type { OutcomeBandKey } from '../outcomes'

/** Map a 0–499 difference onto the assembled band stack, returning its outcome. */
export function classifyOutcome(_difference: number, _diffs: CellDiffs): OutcomeBandKey {
  throw new Error('not implemented')
}
