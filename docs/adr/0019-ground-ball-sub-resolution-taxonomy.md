# 19. Ground-ball sub-resolution and the `groundBallResult` taxonomy

- Status: Accepted
- Date: 2026-06-25

## Context

The RangeFinder classifies a duel into one of ten outcome bands; the back-half
`GB` band is the elastic remainder between `PO` and `K`. Until now `GB` resolved
as a **plain out** — `applyOutcome` recorded one out and moved no runners, an
explicitly deferred seam (ADR-0016 noted "the GB sub-resolution … will" come
later; ADR-0018 leaned on it as the behavior-preserving baseline).

SAN-16 fills that seam. A ground ball with runners on subdivides — by base state,
outs, and the batter/runner/pitcher **speed − awareness** allocation — into a
family of plays: a productive ground out, the fielder's-choice variants, the
force double play, and (rarely) the triple play. Each moves runners and records
outs differently, and the double-play rate is a balance quantity we validate
against MLB. So the play that a `GB` resolved to must be **persisted** on the
append-only `atBats` log (ADR-0004), which makes its shape an architectural
decision — and the runner-aware base state (ADR-0018) is the prerequisite that
makes each on-base runner's speed reachable by id.

## Decision

**Keep the `GB` band; record the sub-result in a new nullable field.**

- **Engine is the single source of truth.** A `GroundBallResult` enum
  (`GO` / `GO_RA` / `FC` / `FC_2ND` / `FC_3RD` / `FC_HOME` / `DP` / `TP`, rules
  §2.9–2.15) lives in `@sandlot/engine/atBat`. `resolveAtBat` sub-resolves the
  `GB` band between `classify` (which now also returns the elastic GB band) and
  the advancement step, and reports `groundBallResult` (null for every non-GB
  outcome).
- **Persistence shape: band stays `GB` + a nullable sibling field.** The
  `outcomeBand` enum is unchanged (its pinning test still passes); `atBats` gains
  `groundBallResult: groundBallResult | null`. The Convex `groundBallResult`
  validator mirrors the engine enum with a compile-time guard and a runtime mirror
  test — the same `outcomeBand ↔ OUTCOME_BAND_KEYS` discipline. Rejected the
  alternative of flattening the sub-results into `outcomeBand`: it would rewrite
  the persisted band taxonomy, break the pinning test, and conflate "what band the
  RangeFinder produced" with "how the ground ball was fielded."
- **Sub-bands partition `[GB.lo, GB.hi]` exactly** — contiguous, gapless,
  non-overlapping, deterministic given (base state, outs, stat diffs), consistent
  with the front/back-half band-assembly invariants. Eligibility is structural
  (empty → `GO`; each FC variant only where its lead-runner occupancy exists;
  `DP` needs a force and < 2 outs; `TP` needs a force at every base in play and
  0 outs). The DP share shrinks and the FC share grows as the speed edge rises.
  `TP` is the thin top-of-band tail, expressed structurally ("top of the GB
  band"), never a literal range. When `TP`/`DP` are ineligible their tail
  reassigns to the next eligible out (the **TP-tail collapse**), so the partition
  stays exact in every base/out state.
- **Third-out run suppression.** Every GB out is a force/fielding out, so when the
  play records the inning-ending out (`GO_RA`'s batter out at 1st, a `DP`
  completing the inning, any `TP`) the runs that would have crossed are wiped —
  affecting both run totals and the GIDP validation.
- **Pitcher-as-runner speed = 1.** A pitcher's attribute block carries no speed,
  but a pitcher can reach base. Rather than add `speed` to every player, the
  Convex boundary maps a pitcher-as-runner to the slowest speed (1) when it looks
  up the runner-speed block. The engine stays roster-free (ADR-0009): it consumes
  a looked-up `BaseSpeeds` block, never a roster handle.

**IP hygiene (ADR-0006).** The sub-band boundaries and DP/FC fractions are
re-derived structurally for this engine and tuned by the Monte Carlo harness
against a public GIDP-per-opportunity baseline — never transcribed from the
reference calculator's tuned Ground Balls sheet (its literal TP sliver and per-
stat FC/DP fractions stay private). `TP` and per-variant FC advancement are
asserted as deterministic structural rules; only the DP rate is rate-gated (`TP`
is too rare to validate as a rate).

**No data migration.** Pre-launch — no production `atBats` rows exist.

This **supersedes the "`GB` resolves as a plain out" provision** of ADR-0018; the
runner-aware base state, occupancy-projection equivalence, and all non-GB
behavior it established are unchanged.

## Consequences

- **+** Each ground ball is recorded as the specific play it was, on the immutable
  log, with the band taxonomy (`outcomeBand`) untouched and its pinning test green.
- **+** The engine remains the single source of truth; the persisted enum can
  never drift (compile-time guard + runtime mirror), matching `outcomeBand`.
- **+** The DP rate is harness-validatable; the partition invariants and third-out
  suppression are unit-pinned.
- **−** `ResolveInput` gains a required `runnerSpeeds` block and `ResolvedAtBat`
  a `groundBallResult`; the Convex boundary looks up on-base runner speeds and
  carries one more typed relabel (`groundBallResult`, alongside `basesAfter`).
- **−** The DP/FC magnitudes are seeds tuned to one baseline; richer validation
  (per-base-state DP rates, RBI-vs-run divergence, errors) is deferred.
