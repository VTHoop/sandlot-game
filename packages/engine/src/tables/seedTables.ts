/**
 * Seed outcome-band width tables for the at-bat engine RangeFinder.
 *
 * Provenance: widths at differential=0 are anchored to 2024 MLB league-average
 * outcome rates (BA .248, HR% 3.3%, BB% 8.7%, K% 22.5%, 2B% 5.4%, 3B% 0.4%,
 * IF1B% ~1.1%; source: Baseball Reference 2024 league batting averages).
 * Formula: rate × 500 = band-width unit on the 0–500 difference line.
 * Differential ±1..±5 scaling is interpolated monotonically from the baseline.
 *
 * Regenerate: re-derive diff-0 anchors from fresh public MLB rate baselines;
 * see docs/engine/attribute-normalization.md for the attribute→rate mapping.
 * Update the checksum in __tests__/seedTables.test.ts after any regeneration.
 *
 * Seed values — deliberately rough; tuned against real MLB rates by SAN-15.
 */

/**
 * Validated batter−pitcher attribute differential in [−5, +5].
 * Use `toAttributeDiff` from `accessor.ts` to convert a raw number at the system
 * boundary; all internal engine functions accept this type, not plain `number`.
 */
export type AttributeDiff = -5 | -4 | -3 | -2 | -1 | 0 | 1 | 2 | 3 | 4 | 5

/** 11-element tuple indexed by attribute differential: [-5, -4, …, 0, …, +4, +5] */
export type OutcomeTable = readonly [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
]

/**
 * HR band width keyed by Power − Velocity differential.
 * Non-decreasing: batter Power advantage widens the HR band.
 * Baseline diff=0: 17 ≈ 3.3% × 500
 */
export const HR: OutcomeTable = [6, 8, 10, 12, 14, 17, 20, 24, 28, 32, 37]

/**
 * 3B band width keyed by Speed − Awareness differential.
 * Non-decreasing: batter Speed advantage widens the 3B band.
 * Baseline diff=0: 2 ≈ 0.4% × 500
 */
export const TRIPLE: OutcomeTable = [1, 1, 1, 1, 2, 2, 3, 4, 5, 6, 8]

/**
 * 2B band width keyed by Speed − Awareness differential.
 * Non-decreasing: batter Speed advantage widens the 2B band.
 * Baseline diff=0: 27 ≈ 5.4% × 500
 */
export const DOUBLE: OutcomeTable = [12, 15, 18, 21, 24, 27, 31, 35, 39, 44, 50]

/**
 * IF1B band width keyed by Speed − Awareness differential.
 * Non-decreasing: batter Speed advantage widens the infield-single band.
 * Baseline diff=0: 6 ≈ 1.1% × 500
 */
export const IF1B: OutcomeTable = [2, 2, 3, 4, 5, 6, 7, 8, 10, 12, 14]

/**
 * BB band width keyed by Eye − Command differential.
 * Non-decreasing: batter Eye advantage widens the walk band.
 * Baseline diff=0: 44 ≈ 8.7% × 500
 */
export const BB: OutcomeTable = [18, 22, 27, 32, 38, 44, 51, 59, 68, 79, 92]

/**
 * Hit-total band width keyed by Contact − Movement differential.
 * Non-decreasing: batter Contact advantage widens the total-hits band.
 * Baseline diff=0: 125 ≈ BA (.248) × 500
 */
export const HIT_TOTAL: OutcomeTable = [72, 83, 94, 106, 115, 125, 136, 148, 161, 175, 190]

/**
 * K band width keyed by Contact − Movement differential.
 * Non-INCREASING: batter Contact advantage narrows the strikeout band.
 * Baseline diff=0: 113 ≈ 22.5% × 500
 */
export const K: OutcomeTable = [165, 155, 145, 136, 124, 113, 103, 93, 84, 75, 67]

/**
 * FO band width keyed by Power − Velocity differential.
 * Non-INCREASING: batter Power advantage reduces fly-out rate (more HRs instead).
 * Baseline diff=0: 85 ≈ 17% × 500
 */
export const FO: OutcomeTable = [100, 96, 92, 89, 87, 85, 79, 74, 69, 64, 59]

/**
 * PO band width keyed by Power − Velocity differential.
 * Non-INCREASING: batter Power advantage reduces pop-out rate (more hard contact).
 * Baseline diff=0: 35 ≈ 7% × 500
 */
export const PO: OutcomeTable = [40, 38, 36, 36, 35, 35, 33, 30, 28, 25, 23]

/**
 * HandSwitcher hit-total width for same-handed matchup (platoon disadvantage).
 * Narrower than OPPOSITE: same-handed slightly favors the pitcher.
 * Baseline diff=0: 120
 */
export const HAND_SAME: OutcomeTable = [69, 80, 90, 101, 110, 120, 130, 141, 153, 167, 181]

/**
 * HandSwitcher hit-total width for opposite-handed matchup (platoon advantage).
 * Wider than SAME: opposite-handed slightly favors the batter.
 * Baseline diff=0: 130
 */
export const HAND_OPPOSITE: OutcomeTable = [75, 86, 98, 110, 120, 130, 141, 153, 166, 181, 197]
