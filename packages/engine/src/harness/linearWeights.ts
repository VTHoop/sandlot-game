import type { RunValues } from './types'

/**
 * Outs per 9-inning game: 3 outs × 9 innings.
 * Used to convert linear-weight runs/PA to runs/game:
 *   runs_per_game = (Σ rate_i × run_value_i) × (OUTS_PER_GAME / out_rate_per_PA)
 */
export const OUTS_PER_GAME = 27

/**
 * Run-environment constant: the average run value of a plate appearance in the
 * 2024 MLB environment. Added to the above-average linear weights below to convert
 * them from "runs above average" (which net to ~0) into ABSOLUTE run values, so the
 * harness estimator R/G = (Σ rate·value / outRate) × 27 produces a real league rate.
 *
 * This is the SAN-15 R/G calibration knob. It was solved via the harness so the
 * weighted aggregate runs/game lands at the 2024 baseline (4.39 ± 0.12). Because
 * R/G is exactly linear in a uniform shift of all weights, this single constant
 * sets the run environment without disturbing any rate gate. Reproduce with
 * `pnpm derive-balance`.
 */
export const RUN_ENVIRONMENT_CONSTANT = 0.127

/**
 * Linear-weight run values per outcome (ABSOLUTE runs).
 *
 * Framework: Palmer/Tango linear-weights methodology. The run-value DIFFERENCES
 * between outcomes (HR−1B, 2B−1B, BB−out, …) are the standard above-average Tango
 * weights; every value is then shifted up by RUN_ENVIRONMENT_CONSTANT to express
 * absolute runs in the 2024 environment (see that constant's note).
 *
 * Provenance: derived by us against public 2024 MLB baselines (FanGraphs Guts page
 * + "The Book" Tango/MGL/Dolphin methodology) per ADR-0006 and ADR-0015 — not
 * transcribed from any private source workbook. Keep this table injectable.
 *
 * Distinctions (preserved as value differences):
 * - IF1B treated equal to 1B (no stolen-base premium in this model layer).
 * - GB valued equal to fly outs: sub-resolution of GB→FC/DP/TP is a later stage;
 *   at this layer GB is approximately an average batted-ball out.
 * - K valued slightly worse than contact outs: no GIDP exposure, but marginal
 *   momentum cost recognised in run expectancy studies.
 */
export const DEFAULT_LINEAR_WEIGHTS: RunValues = {
  hr: 1.4 + RUN_ENVIRONMENT_CONSTANT,
  triple: 1.04 + RUN_ENVIRONMENT_CONSTANT,
  double: 0.77 + RUN_ENVIRONMENT_CONSTANT,
  single: 0.47 + RUN_ENVIRONMENT_CONSTANT,
  if1b: 0.47 + RUN_ENVIRONMENT_CONSTANT,
  bb: 0.31 + RUN_ENVIRONMENT_CONSTANT,
  fo: -0.26 + RUN_ENVIRONMENT_CONSTANT,
  po: -0.26 + RUN_ENVIRONMENT_CONSTANT,
  gb: -0.26 + RUN_ENVIRONMENT_CONSTANT,
  k: -0.3 + RUN_ENVIRONMENT_CONSTANT,
}
