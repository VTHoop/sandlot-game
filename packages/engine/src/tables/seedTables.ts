/**
 * Outcome-band width tables for the at-bat engine RangeFinder.
 *
 * Tuned by SAN-15 so the WEIGHTED AGGREGATE slash line over the default
 * triangular differential distribution lands inside the 2024 MLB tolerance gates
 * (see harness/baselines.ts and ADR-0011). The diff=0 column is an anchor, NOT
 * the league average: because the triangular weight is symmetric and these tables
 * are mildly convex, the aggregate differs from the diff=0 cell. What is validated
 * against MLB is the aggregate, reproduced by `pnpm derive-balance`.
 *
 * Each rate = band_width / 500 (the 0–499 circular-fold identity). Differential
 * scaling is monotonic so the directional invariants hold (HR% non-decreasing in
 * Power−Velocity, K% non-increasing in Contact−Movement, BB% non-decreasing in
 * Eye−Command, 2B+3B non-decreasing in Speed−Awareness).
 *
 * Provenance: independently derived against public 2024 MLB rate baselines via the
 * simulation harness — never transcribed from any private source workbook (AGENTS.md
 * IP hygiene). Regenerate with `pnpm derive-balance`; update the checksum in
 * __tests__/seedTables.test.ts after any retune.
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
 * Diff=0 anchor: 15. Aggregate HR% ≈ 3.1% (marginal mean 15.3 / 500).
 */
export const HR: OutcomeTable = [5, 7, 8, 10, 12, 15, 17, 21, 24, 28, 32]

/**
 * 3B band width keyed by Speed − Awareness differential.
 * Non-decreasing: batter Speed advantage widens the 3B band.
 * Baseline diff=0: 2 ≈ 0.4% × 500
 */
export const TRIPLE: OutcomeTable = [1, 1, 1, 1, 2, 2, 3, 4, 5, 6, 8]

/**
 * 2B band width keyed by Speed − Awareness differential.
 * Non-decreasing: batter Speed advantage widens the 2B band.
 * Diff=0 anchor: 18. Lowered from the prior 27 so aggregate SLG lands at ~.399.
 */
export const DOUBLE: OutcomeTable = [8, 10, 12, 14, 16, 18, 20, 22, 24, 27, 31]

/**
 * IF1B band width keyed by Speed − Awareness differential.
 * Non-decreasing: batter Speed advantage widens the infield-single band.
 * Diff=0 anchor: 5. IF1B and 1B both count as a single hit / one base, so this
 * table is balance-neutral for the slash line; the high end is held down to keep
 * 1B (the hit-total residual) positive at high Speed−Awareness (zero degenerate).
 */
export const IF1B: OutcomeTable = [2, 2, 3, 3, 4, 5, 6, 7, 8, 10, 12]

/**
 * BB band width keyed by Eye − Command differential.
 * Non-decreasing: batter Eye advantage widens the walk band.
 * Diff=0 anchor: 41. Aggregate BB% ≈ 8.5% (marginal mean 42.5 / 500); held toward
 * the upper gate edge so AVG and OBP can both sit inside their gates (a 2-outcome
 * AB-or-BB model has no HBP, which tightens the AVG↔OBP relationship).
 */
export const BB: OutcomeTable = [18, 21, 26, 30, 35, 41, 47, 55, 64, 74, 86]

/**
 * Hit-total band width keyed by Contact − Movement differential.
 * Non-decreasing: batter Contact advantage widens the total-hits band.
 * Diff=0 anchor: 111. Drives aggregate h = M(HIT)/500 ≈ .224, giving AVG ≈ .245
 * and OBP ≈ .310. The low (Contact-weak) end is held up enough that the 1B
 * residual stays positive even at high Power and Speed advantage.
 */
export const HIT_TOTAL: OutcomeTable = [66, 76, 84, 94, 102, 111, 121, 131, 143, 155, 169]

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
