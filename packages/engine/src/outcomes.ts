import type { BackHalfBands } from './rangeFinder/backHalf'
import type { FrontHalfBands } from './rangeFinder/frontHalf'

/**
 * Canonical at-bat outcome band keys.
 *
 * Derived directly from the RangeFinder band partitions so the engine remains
 * the single source of truth: any band added to or renamed in
 * {@link FrontHalfBands} / {@link BackHalfBands} flows through here, and the
 * exhaustiveness guard below fails typecheck if {@link OUTCOME_BAND_KEYS}
 * drifts from the actual bands.
 *
 * Consumers (e.g. the Convex `atBats.outcome` validator) mirror this type so
 * the persisted outcome enum can never diverge from what the engine produces.
 */
export type OutcomeBandKey = keyof FrontHalfBands | keyof BackHalfBands

/**
 * The band keys in fixed best → worst stack order:
 * `HR → 3B → 2B → 1B → IF1B → BB → FO → PO → GB → K`.
 */
export const OUTCOME_BAND_KEYS = [
  'HR',
  '3B',
  '2B',
  '1B',
  'IF1B',
  'BB',
  'FO',
  'PO',
  'GB',
  'K',
] as const satisfies readonly OutcomeBandKey[]

// Compile-time single-source-of-truth guard: the tuple must list every band key
// exactly once. If a band is added/removed/renamed in the RangeFinder without
// updating OUTCOME_BAND_KEYS, one of these assignments stops type-checking.
type TupleKey = (typeof OUTCOME_BAND_KEYS)[number]
type _TupleCoversAllBands = OutcomeBandKey extends TupleKey ? true : never
type _BandsCoverWholeTuple = TupleKey extends OutcomeBandKey ? true : never
const _tupleCoversAllBands: _TupleCoversAllBands = true
const _bandsCoverWholeTuple: _BandsCoverWholeTuple = true
void _tupleCoversAllBands
void _bandsCoverWholeTuple
