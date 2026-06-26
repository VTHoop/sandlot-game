# 21. Deterministic run-advancement and the bunt swing-mode

- Status: Accepted
- Date: 2026-06-26

## Context

ADR-0016 established the folded 0–499 duel space and the dual-use `resolveAtBat`;
ADR-0019 sub-resolved the `GB` band into a base/out/speed-keyed family. Two
workbook modules remained un-ported (SAN-17): **Extra-base / Deep-fly
advancement** (Rules §3.2/§3.3) and **Bunts** (Rules §3.4). Both are about *where
runners end up*, not *which outcome band* the duel produced — and both must stay
deterministic (no new RNG) and roster-free (ADR-0009), with runner speeds arriving
as caller-supplied inputs, exactly like the GB speed axis.

The Monte Carlo harness models at-bat outcome *rates* (which band), not baserunning
movement, so it cannot gate these effects today; aggregate run-environment
believability is deferred with the game-loop work (ADR-0020). Assertions are
therefore structural rules from Rules §3 plus gitignored parity fixtures (ADR-0006)
— the same methodology as the front/back-half and GB ports.

## Decision

Resolve all SAN-17 run movement as **deterministic width ranges in the folded
0–499 space**, sub-resolved by `resolveAtBat` upstream of the plain advancers,
mirroring the GB interception. Two parts, landed across stacked PRs:

### Part A — extra-base / deep-fly / IF1B advancement (`atBat/advancement/`)

- `classify` now also returns the **matched outcome band**; `resolveAtBat` routes
  `1B`/`2B` → `resolveExtraBase`, `FO` → `resolveFlyOut`, and `IF1B` →
  `advanceInfieldSingle`. Every other band keeps `applyOutcome` (ADR-0016). The
  plain advancers remain the primitive/base case (e.g. `applyOutcome('IF1B', …)`
  is still the one-base `single`), exactly as `applyOutcome('GB', …)` stays a plain
  field-out behind the GB sub-resolution.
- **Extra base (§3.2):** a trailing runner takes one extra base when the folded
  difference lands in the batter-favorable (low) end of the hit band; the granting
  range widens with the runner's own speed (and the hitter's power where the tab
  uses it). A trailing runner never passes the runner ahead (1st→3rd on a single
  needs 3rd vacated). The no-extra case reduces exactly to the standard
  single/double.
- **Deep fly / sac fly (§3.2.6.1):** a deep fly (low end of the `FO` band, share
  widening with power) with < 2 outs scores the runner from 3rd (sac fly, RBI
  credited) and tags the runner on 2nd up to 3rd; the batter is always out. A
  shallow fly, a 2-out fly, or a state with no tagging runner is a plain out.
- **Infield single (§3.3):** structural, no width range — with < 2 outs only forced
  runners advance (a walk's push); with 2 outs every runner advances one base, never
  an extra base. An IF1B is a hit, so no out is recorded.
- The effects are fully captured by the existing persisted fields (`basesAfter` /
  `runsScored` / `rbi` / `outcome`), so **no schema change** is needed for Part A.
- **`emit-grid` is unchanged** — advancement never alters band classification, only
  the post-state, so the aggregate slash line is byte-identical.

### Part B — the bunt swing-mode (`atBat/bunt/`, follow-up PR)

- A new **`SwingType` enum** (`Normal` | `Bunt`; a TS enum per the project's
  prefer-enums convention, the literal union confined to the Convex schema layer)
  is an **optional** `ResolveInput` field defaulting to `Normal`, so existing
  engine/Convex callers are undisturbed (at-bat UI wiring is out of SAN-17 scope).
- A bunt is **one declaration**: the player does not pre-choose sacrifice vs
  bunt-for-hit. The bunt path **bypasses** the RangeFinder stack and resolves the
  outcome family off the single folded difference + base state — a sibling of the
  outcome-band stack, parallel to the GB sub-resolution:
  - bottom tail → **butcher boy** (batter awarded a single, all runners advance one
    extra base);
  - top tail → **triple play** (double play when a triple play is structurally
    impossible — the TP-tail collapse of ADR-0019);
  - middle → **bunt-for-hit / sac SAFE-or-OUT / dud**, sized by re-derived Sac
    Ranges + Bunt-for-Hit width tables keyed on the Cnt-vs-Mov / Spe-vs-Awa
    differentials and base occupancy; a failed bunt is a dud (batter out, no
    advance).
- A new **`BuntResult` taxonomy** is persisted as a nullable sibling field on
  `atBats` (mirroring `groundBallResult`/ADR-0019: an explicit `v.union` validator
  with a compile-time `AssertEqual` guard + a runtime members-equality test), and
  `swingType` is persisted on `atBats`. The bunt's persisted `outcome` band maps
  onto a representative existing band for rollup compatibility.
- **Bunt bonus** (a bunting pitcher's contact raised to 4) is a **caller-side input
  adjustment** at the Convex boundary, never engine logic — the engine stays
  roster-free (ADR-0009), the same discipline as park effects in ADR-0020.

### IP hygiene (ADR-0006)

All extra-base / deep-fly / sac / bunt-for-hit widths and fractions are **re-derived
structurally** for this engine and exposed behind injectable accessors (frozen test
tables pin exact boundaries, SAN-15-retune-proof) — never transcribed from the
reference calculator's ExtraBase / Bunts tabs. Parity fixtures captured by
`scripts/captureParity.py` stay gitignored. No harness rate gate is added for run
movement in MVP (ADR-0020).

## Consequences

- **+** The complete single-at-bat surface (RangeFinder + GB + extra-base/deep-fly
  + bunts) resolves deterministically from pitch + swing + attributes, with no new
  RNG and no roster handle.
- **+** Part A needs no schema change and leaves `emit-grid` untouched; the band
  taxonomy and its pinning test are unaffected.
- **+** The bunt taxonomy is persisted on the immutable log with the same
  single-source-of-truth guard as `groundBallResult`.
- **−** `classify` returns one more field (`band`); `ResolveInput` gains an optional
  `swingType`; `atBats` gains `swingType` + `buntResult`. No migration (pre-launch).
- **−** The advancement/bunt widths are seeds tuned to structural rules, not yet a
  harness-validated run environment; richer validation (steal-inclusive run rates,
  per-state advancement rates) is deferred with the game loop (ADR-0020).
- This ADR **extends** ADR-0016/0018/0019 rather than superseding them; all band,
  fold, runner-aware-base, and GB behavior is unchanged.
