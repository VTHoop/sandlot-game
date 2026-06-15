# 15. SAN-15 balance retune — seed-table tuning + run-environment calibration

- Status: Accepted
- Date: 2026-06-15
- Supersedes: the run-value table in [ADR-0010](./0010-balance-harness-linear-weights-methodology.md) Decision 2 (the methodology in 0010 still stands).

---

## Context

[ADR-0010](./0010-balance-harness-linear-weights-methodology.md) built the exact-enumeration balance harness and shipped *rough* seed tables, explicitly deferring tuning to SAN-15. In that pre-tuned state the weighted aggregate slash line sat well above the modern league (AVG .278 / OBP .344 / SLG .469, HR% 3.6%, BB% 9.1%), aggregate R/G was near zero (the linear weights net to ~0 runs/PA by construction), and **45 reachable matchups were degenerate** (1B residual ≤ 0).

SAN-15 tunes the engine so the aggregate lands inside the 2024 MLB tolerance gates, with only two knobs permitted: the band-width tables in `seedTables.ts` and `DEFAULT_LINEAR_WEIGHTS` in `linearWeights.ts`.

---

## Decision 1 — Tune band widths against the per-table marginal mean

The default differential weight factorizes across the four attribute dimensions and is symmetric, so **each aggregate rate equals one table's triangular-weighted marginal mean ÷ 500**, with the d = ±5 ends carrying zero weight. The slash line collapses to closed forms:

```
h_rate = M(HIT_TOTAL)/500      bb_rate = M(BB)/500
OBP = (M(HIT_TOTAL) + M(BB))/500
AVG ≈ h_rate / (1 − bb_rate)
SLG ≈ (M(HIT_TOTAL) + 3·M(HR) + 2·M(3B) + M(2B))/500 / (1 − bb_rate)
```

where `M(table) = Σ_{d=-4..4} (5−|d|)/25 · table[d+5]`. This let us aim each knob directly rather than search blindly. Tuned diff=0 anchors: HR 17→15, 2B 27→18, BB 44→41, HIT_TOTAL 125→111, IF1B high end trimmed; TRIPLE, K, FO, PO unchanged.

Two design points worth recording:

- **BB% is held toward the upper gate edge (~8.5%).** A 2-outcome (AB-or-BB) model has no HBP or SF, which tightens the AVG↔OBP relationship; a higher walk rate is what lets AVG (.246) and OBP (.310) both sit inside their gates simultaneously.
- **The diff=0 column is an anchor, not the league average.** Because the tables are mildly convex and the weight is symmetric, the *aggregate* differs from the diff=0 cell. The aggregate is what is validated against MLB.

**Zero degenerate cells:** HIT_TOTAL's low (Contact-weak) end is held high enough, and the XBH/IF1B high ends low enough, that the 1B residual stays positive across every reachable (|diff| ≤ 4) matchup. The pre-SAN-15 count of 45 is now 0 and ratcheted there.

## Decision 2 — Calibrate the run environment with a single additive constant

R/G is the only gate that depends on the run values, and it is exactly linear in a uniform shift of all weights. The Palmer/Tango weights in ADR-0010 are **above-average** values (runs relative to a generic out) that net to ~0 over a league-average lineup — so the estimator `R/G = (Σ rate·value / outRate) × 27` produced ~0 R/G. We add a single **run-environment constant (`+0.127`)** to every weight to convert them to **absolute** run values, the textbook above-average → absolute transform. This preserves every run-value *difference* (HR−1B, BB−out, …) exactly as the Tango framework specifies and disturbs no rate gate; it only sets the run environment. The constant was solved via the harness so aggregate R/G = 4.39.

Updated run values (absolute): HR +1.527, 3B +1.167, 2B +0.897, 1B/IF1B +0.597, BB +0.437, FO/PO/GB −0.133, K −0.173.

---

## Outcome (reproduce with `pnpm derive-balance`)

| Stat | Aggregate | 2024 gate | |
|---|---|---|---|
| AVG | .246 | .243 ± .004 | ✅ |
| OBP | .310 | .312 ± .004 | ✅ |
| SLG | .397 | .399 ± .008 | ✅ |
| HR% | 3.06% | 3.1% ± 0.3pp | ✅ |
| K% | 22.78% | 22.6% ± 0.8pp | ✅ |
| BB% | 8.50% | 8.2% ± 0.4pp | ✅ |
| R/G | 4.40 | 4.39 ± 0.12 | ✅ |

Directional invariants hold (HR%↑ in Power−Velocity, K%↓ in Contact−Movement, BB%↑ in Eye−Command, 2B+3B↑ in Speed−Awareness); 0 leaked degenerate cells; partition + GB ≥ 0 hold across all 14,641 cells.

**Provenance:** the 2024 MLB baselines and tolerance gates live in `packages/engine/src/harness/baselines.ts` (retrieved 2026-06-15 from Baseball Reference 2024 league batting + FanGraphs league dashboard). Balance is **independently derived** against these public aggregates via the harness — never transcribed from any private source workbook (ADR-0006, AGENTS.md IP hygiene).

---

## Consequences

- The balance gate is committed in `harness.test.ts`: `assertAggregate` against the 2024 config + the four directional invariants + `validateEnumeration` (0 leaked) + `validateGridInvariants`. Any retune that drifts out of a gate or breaks an invariant fails CI.
- `pnpm derive-balance` is the committed, human-auditable derivation: it prints each table's marginal mean and every gate's pass/fail, and exits non-zero on any miss.
- The diff=0 identity/formula unit tests were rewritten as **balance-agnostic property tests** over the whole grid (rate = width/500, the slash formulas, the R/G estimator), so the mechanic layer no longer breaks on a retune. Balance now lives in exactly one place — the aggregate gate.
- `aggregateRunsPerGame` (pooled numerator/denominator, not a per-cell average) is the league-level R/G used by the gate.
- The `+0.127` constant is a property of the 2024 run environment; a future run-environment change re-solves that one number without touching the band tables.
