import type { BaselineConfig, ToleranceConfig } from './types'

/**
 * 2024 MLB league-average rate baselines and SAN-15 tolerance gates.
 *
 * Provenance: 2024 MLB league totals, retrieved 2026-06-15 from public sources
 * (Baseball Reference 2024 league batting + FanGraphs league dashboard). These
 * are independently transcribed public league aggregates — NOT derived from any
 * private source workbook (see ADR-0011 and the IP hygiene rules in AGENTS.md).
 *
 * Rates are expressed as fractions of a plate appearance (HR%, K%, BB%) or the
 * standard slash-line ratios (AVG = H/AB, OBP = (H+BB)/PA, SLG = TB/AB).
 *
 * Tolerances are the SAN-15 acceptance gates: the weighted aggregate slash line
 * over the default triangular differential distribution must land inside every
 * gate simultaneously.
 */
export const MLB_2024_BASELINE: BaselineConfig = {
  avg: 0.243,
  obp: 0.312,
  slg: 0.399,
  hrPct: 0.031,
  kPct: 0.226,
  bbPct: 0.082,
}

export const MLB_2024_TOLERANCE: ToleranceConfig = {
  avg: 0.004,
  obp: 0.004,
  slg: 0.008,
  hrPct: 0.003,
  kPct: 0.008,
  bbPct: 0.004,
}

/** 2024 MLB runs/game (both teams averaged): 4.39 ± 0.12. */
export const MLB_2024_RUNS_PER_GAME = 4.39
export const MLB_2024_RUNS_PER_GAME_TOLERANCE = 0.12
