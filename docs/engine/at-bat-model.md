# At-bat model — vocabulary & structure

The shared mental model for the at-bat resolution engine: what the recurring terms (**RangeFinder**, **outcome bands**, **front half**, **the sheet**) mean and how the pieces fit. This is **structure only** — the conceptual model, not the tuned numbers. Safe to commit: game *mechanics and structure* aren't copyrightable, and this doc contains **no** verbatim width tables from the source calculator (see [ADR-0006](../adr/0006-ip-branding-and-data-sourcing.md)). The actual tuned values are re-derived via our own simulation and live in code; the original decoded reference is kept **private, out of this repo**.

## Glossary

- **Hidden-number duel** — the core mechanic ([CONTEXT.md](../CONTEXT.md)): pitcher submits a secret number `1–1000`, batter submits one, and the outcome is decided by *how close* they are.
- **Difference** — the absolute distance between the two numbers, folded into `0–499` (closer guess → smaller difference → better outcome for the batter). This single value is what the bands partition.
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
- **Back half — `FO / PO / GB / K`.** An **elastic remainder**: K is anchored at the far end (`499`), GB stretches to fill the gap, and FO/PO split the leftover. Because it's interdependent rather than a simple sum, it's verified by **Monte Carlo simulation** against public MLB rate baselines rather than by exact-value unit tests.

After the bands are assembled, later stages apply on top: **ground-ball sub-resolution**, **park effects**, then **steals / bunts / extra-base** (all separate roadmap items).

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
| `packages/engine/reference/` | Gitignored local parity fixtures (never committed) |
| `docs/engine/attribute-normalization.md` | How MLB stats → 1–5 attributes |
| `docs/adr/0006-*` | IP & data-sourcing rules |

## Where the details live

- **Conceptual / structural (here):** this doc + [attribute-normalization.md](./attribute-normalization.md).
- **Tuned numbers:** re-derived via our simulation harness and validated against public MLB baselines (ADR-0006) — they live in code, not prose.
- **Decoded source reference (private, do *not* commit):** `/Users/hoop/dev/bbtn-engine-spec.md` and the source workbook on disk — see [CONTEXT.md → Build references](../CONTEXT.md).
