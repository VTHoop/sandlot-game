# ADR-0010: Balance harness — exact enumeration + linear-weights run valuation

**Date:** 2026-06-11
**Status:** Accepted
**Supersedes:** nothing
**Affects:** `packages/engine/src/harness/`

---

## Context

SAN-14 introduces the balance-validation and price-derivation instrument for the at-bat engine. It must:
1. Produce **exact** outcome probabilities (no RNG, no sampling) for any batter–pitcher matchup.
2. Convert those probabilities into a slash line (AVG/OBP/SLG/HR%/K%/BB%) and a "runs per game" scalar.
3. Enumerate the full 4-D differential grid (11⁴ = 14 641 cells) and aggregate against a configurable differential distribution.
4. Expose a configurable assertion API for SAN-15 (CI balance gate) and emit a machine-readable artifact for SAN-18 (attribute pricing).

Two methodological decisions required recording.

---

## Decision 1 — Exact enumeration, not Monte Carlo sampling

The harness computes **exact probabilities** directly from band widths. For a given matchup:

```
rate(outcome) = band_width / 500
```

This identity holds because the circular/shorter-arc fold of two uniform `1–1000` draws is uniform on `0–499` (not a triangular distribution; that would require integrating the difference density over each band). The word "Monte Carlo" in the ticket name is a misnomer from the original brief: the instrument is an exact analytic harness, not a stochastic simulator. Stochastic simulation is reserved for the future game-scoring layer.

**Rejected alternative:** N-trial sampling with convergence checking. Exact enumeration gives zero sampling error, is fully deterministic, runs faster, and is simpler to assert against.

---

## Decision 2 — Palmer/Tango linear-weights run valuation

**Formula:**
```
runs_per_PA  = Σ (rate_i × weight_i)
runs_per_game = runs_per_PA / out_rate × 27
```
`27` = 3 outs × 9 innings (standard game). `out_rate` = K + GB + FO + PO rates.

**Run values (calibrated to 2024 MLB run environment, ~4.38 R/G):**

| Outcome | Weight |
|---|---|
| HR | +1.40 |
| 3B | +1.04 |
| 2B | +0.77 |
| 1B / IF1B | +0.47 |
| BB | +0.31 |
| FO / PO / GB | −0.26 |
| K | −0.30 |

Values are **runs above the league-average out** (Palmer framework calibrated via FanGraphs 2024 Guts page + "The Book" Tango/MGL/Dolphin methodology). An average matchup (all diffs = 0) produces a small positive value because the seed tables are seeded slightly above exact MLB averages and will be retuned by SAN-15.

**Provenance:** derived by us against public 2024 MLB baselines. Not transcribed from any private source workbook (ADR-0006). GB is valued at the same level as fly outs because ground-ball sub-resolution (FC/DP/TP) is a later engine stage. K is valued slightly worse than contact outs consistent with published linear-weight studies (no GIDP exposure is offset by a marginal run-expectancy cost in high-leverage counts).

**Rejected alternative:** wRC-style wOBA weights. These require a separate scaling factor and are less legible for the balance-validation use case. Palmer weights give a direct "runs above average" interpretation.

---

## Decision 3 — Injectable differential distribution (default: triangular from attribute buckets)

The default weight for each grid cell is the product of four independent marginal weights:

```
P(diff = d) = (5 − |d|) / 25   for d ∈ {−4,…,+4}
P(diff = ±5) = 0               (unreachable: attrs are 1–5, so max |diff| = 4)
```

This is the convolution of two independent Uniform{1,5} random variables, which matches the attribute-bucket normalization design (attribute-normalization.md).

The distribution is an **injected parameter** on `aggregateGrid`. SAN-15 retuning and the future real-pool weighting (P1 deferred) require no code surgery.

---

## Consequences

- The harness is pure TypeScript with no I/O in the core path — fully unit-testable and importable into Convex server functions.
- `enumerateGrid` silently skips degenerate cells (1B ≤ 0 or GB ≤ 0): these are unreachable from valid attribute matchups and are not valid system inputs.
- `validateGridInvariants` provides the partition-completeness and GB ≥ 0 assertions as a first-class API for SAN-15's CI gate.
- The artifact JSON (`packages/engine/artifacts/san14-grid.json`) is gitignored as a generated output; SAN-18 regenerates it on demand.
