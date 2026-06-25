# At-bat model — vocabulary & structure

The shared mental model for the at-bat resolution engine: what the recurring terms (**RangeFinder**, **outcome bands**, **front half**, **the sheet**) mean and how the pieces fit. This is **structure only** — the conceptual model, not the tuned numbers. Safe to commit: game *mechanics and structure* aren't copyrightable, and this doc contains **no** verbatim width tables from the source calculator (see [ADR-0006](../adr/0006-ip-branding-and-data-sourcing.md)). The actual tuned values are re-derived via our own simulation and live in code; the original decoded reference is kept **private, out of this repo**.

## Glossary

- **Hidden-number duel** — the core mechanic ([CONTEXT.md](../CONTEXT.md)): pitcher submits a secret number `1–999`, batter submits one, and the outcome is decided by *how close* they are.
- **Difference** — the circular distance between the two numbers on a **ring of 999**, `min(d, 999 − d)` where `d = |pitch − swing|` ([ADR-0016](../adr/0016-duel-number-domain-and-authoritative-resolver.md)). An odd ring has no antipode, so this folds onto exactly `0–499` (closer guess → smaller difference → better outcome for the batter) with no clamp. This single value is what the bands partition.
- **Outcome bands** — the `0–499` difference line is partitioned into an **ordered stack of outcomes, best → worst**. Whichever band the difference lands in is the result of the at-bat. A band's **width** comes from a table lookup keyed by the matchup (see *attribute differentials*); wider band = more likely outcome.
- **RangeFinder** — the *assembler*: the logic that takes the attribute differentials, looks up each band's width, and lays the bands out end-to-end into the final partition. Named after the source workbook tab that does this.
- **"The sheet"** — the reverse-engineered source calculator (a Google Sheets / Excel workbook). It is a **private reference for structure only**, deliberately **not committed** (ADR-0006). "Unit-test against the sheet's values" means: validate our port against values captured from that private reference, not that the sheet ships here.
- **Front half / back half** — the two halves of the band stack, split by *how each band's width is computed* (see below).

## The band stack

The difference line partitions into this fixed order, best → worst:

```
HR → 3B → 2B → 1B → IF1B → BB → FO → PO → GB/GO (→ FC/DP/TP family) → K
```

- **HR** = home run, **3B/2B/1B** = triple/double/single, **IF1B** = infield single, **BB** = walk, **FO/PO** = fly/pop out, **GB/GO** = ground ball/out (which sub-resolves into fielder's-choice / double-play / triple-play by base-state, outs, and speed), **K** = strikeout.
- Order is fixed; only the **widths** move with the matchup.

## Attribute differentials

Each band's width is keyed by a `batter − pitcher` attribute differential, **clamped to `[−5, +5]`**. The pairings (which attribute matchup drives which outcomes):

| Differential | Drives |
|---|---|
| **Power − Velocity** | HR, FO, PO |
| **Contact − Movement** | hit-total & K |
| **Speed − Awareness** | 2B, 3B, IF1B |
| **Eye − Command** | BB |

(Attribute definitions and how real stats map onto the `1–5` scale: [attribute-normalization.md](./attribute-normalization.md).)

## Front half vs. back half — why the split

The two halves differ in **how each band's width is computed**, which is why they're built (and tested) separately:

- **Front half — `HR → BB`.** A clean **cumulative sum** of independent table lookups: look up each band's width, lay them out one after another from `0`. Deterministic and self-contained, so it's **unit-tested directly** against captured reference values.
- **Back half — `FO / PO / GB / K`.** An **elastic remainder**: K is **right-anchored at 499** (K.hi = 499 always; K.lo = 499 − K_width + 1, where K_width comes from the Contact − Movement table). FO and PO fill in from the front (FO → PO starting at BB.hi + 1, keyed by Power − Velocity). GB is the elastic fill between PO.hi + 1 and K.lo − 1 — no seed table; it absorbs whatever space remains. An assembler error is raised if FO + PO + K exceed the available back-half space (GB_width < 0). The partition is unit-tested with frozen tables for exact boundaries and a live-table smoke test confirms GB ≥ 0 across the full differential grid.

After the bands are assembled, later stages apply on top: **ground-ball sub-resolution** (below, SAN-16), then **park effects** and **steals / bunts / extra-base** (still separate roadmap items).

## Ground-ball sub-resolution (SAN-16 / ADR-0019)

The `GB` band is not a single out. When the difference lands in it, the band
**sub-resolves** into the ground-ball play that actually happened — driven by base
state, outs, and the batter/runner/pitcher **speed − awareness** allocation. The
persisted band stays `GB`; the sub-result is recorded alongside it as a nullable
`groundBallResult` (null for every non-GB outcome). The sub-results
(rules §2.9–2.15):

- **GO** — bases empty: batter out at 1st.
- **GO, RA** — out at 1st, all runners advance one base (a run scores from 3rd).
- **FC / FC 2nd / FC 3rd / FC Home** — fielder's choice: a runner is cut down at
  2nd / 3rd / home while the batter (and, per variant, the lead runners) are safe.
- **DP** — force double play (needs a force and < 2 outs): batter + lead forced
  runner.
- **TP** — triple play (needs a force at every base in play and 0 outs): the thin
  **top tail** of the GB band.

The sub-bands **partition `[GB.lo, GB.hi]` exactly** (contiguous, gapless,
non-overlapping), the same invariant the front/back-half assembly holds. Only the
results eligible for the current base/out state are seated; as the speed edge
rises the **DP share shrinks and the FC share grows**. When `TP`/`DP` are
ineligible their tail collapses onto the next eligible out, so the partition stays
exact in every state. The inning-ending out **suppresses** the runs that would
have scored on the play. Magnitudes (the DP-vs-FC fractions, the TP tail) are
**re-derived** and tuned by the harness against a public GIDP baseline — never
transcribed from the private calculator (ADR-0006).

## RangeFinder — assembly contract

The **front-half assembler** (`assembleFrontHalf` in `rangeFinder/frontHalf.ts`) takes the four differentials and returns an object of named bands, each with `{lo, hi}` boundaries (inclusive, 0-indexed). The assembler is:

- **Deterministic**: same inputs always produce the same bands.
- **Self-contained**: no I/O, no randomness, no clock.
- **Injectable**: the accessor functions are a parameter so unit tests can freeze the tables without touching `seedTables.ts` — SAN-15 retuning never breaks the structural test suite.

## Key files

| Path | Purpose |
|---|---|
| `packages/engine/src/tables/seedTables.ts` | Width tables (OutcomeTable arrays, 11 entries each) |
| `packages/engine/src/tables/accessor.ts` | Typed accessors: `getHr`, `getBb`, `getSingle`, etc. |
| `packages/engine/src/rangeFinder/frontHalf.ts` | Front-half assembler (`assembleFrontHalf`) |
| `packages/engine/src/rangeFinder/backHalf.ts` | Back-half assembler (`assembleBackHalf`) |
| `packages/engine/reference/` | Gitignored local parity fixtures (never committed) |
| `docs/engine/attribute-normalization.md` | How MLB stats → 1–5 attributes |
| `docs/adr/0006-*` | IP & data-sourcing rules |

## Where the details live

- **Conceptual / structural (here):** this doc + [attribute-normalization.md](./attribute-normalization.md).
- **Tuned numbers:** re-derived via our simulation harness and validated against public MLB baselines (ADR-0006) — they live in code, not prose.
- **Decoded source reference (private, do *not* commit):** `/Users/hoop/dev/bbtn-engine-spec.md` and the source workbook on disk — see [CONTEXT.md → Build references](../CONTEXT.md).
