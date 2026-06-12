import type { RunValues } from './types'

/**
 * Outs per 9-inning game: 3 outs × 9 innings.
 * Used to convert linear-weight runs/PA to runs/game:
 *   runs_per_game = (Σ rate_i × run_value_i) × (OUTS_PER_GAME / out_rate_per_PA)
 */
export const OUTS_PER_GAME = 27

/**
 * Linear-weight run values per outcome.
 *
 * Framework: Palmer/Tango linear-weights methodology; values are calibrated to the
 * 2024 MLB run environment (~4.38 R/G). Each value is runs above the league-average
 * out: positive for productive outcomes, negative for outs.
 *
 * Provenance: derived by us against public 2024 MLB baselines (FanGraphs Guts page
 * + "The Book" Tango/MGL/Dolphin methodology) per ADR-0006 — not transcribed from
 * any private source workbook. SAN-15 owns retuning; keep this table injectable.
 *
 * Distinctions:
 * - IF1B treated equal to 1B (no stolen-base premium in this model layer).
 * - GB valued slightly better than fly outs: sub-resolution of GB→FC/DP/TP is a
 *   later stage; at this layer GB is approximately an average batted-ball out.
 * - K valued slightly worse than contact outs: no GIDP exposure, but marginal
 *   momentum cost recognised in run expectancy studies.
 */
export const DEFAULT_LINEAR_WEIGHTS: RunValues = {
  hr: 1.4,
  triple: 1.04,
  double: 0.77,
  single: 0.47,
  if1b: 0.47,
  bb: 0.31,
  fo: -0.26,
  po: -0.26,
  gb: -0.26,
  k: -0.3,
}
