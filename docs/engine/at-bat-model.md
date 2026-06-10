# At-Bat Model — RangeFinder vocabulary

Orientation for any agent or developer working on the engine. The RangeFinder is the core at-bat resolution algorithm: given two submitted numbers and eight player attributes, it produces a single game outcome.

---

## The hidden-number duel

The pitcher secretly submits a number **1–1000**. The batter secretly submits a number **1–1000**. The server computes the absolute difference (`|pitcher − batter|`) — the **score** — and maps it onto the outcome partition. This score is server-only; neither player sees the other's number until resolution is complete.

**Practical range:** the maximum possible score is 999 (1 vs 1000). The difference space is always **0–999**, but the RangeFinder is calibrated on a **0–499** half-range (symmetry: `|p − b|` and `|b − p|` are the same, so a uniform random pair produces a mean score near 500; the half-range treats the game as if both players independently draw from 0–499).

---

## Outcome bands

The 0–499 range is partitioned into contiguous, non-overlapping bands, each representing one outcome. A score that falls inside a band resolves to that outcome. The bands are built from **width tables** indexed by attribute differentials; wider bands are more likely outcomes.

### Band order — front half (power outcomes)

The **front half** is stacked from the **low end** of the range. Each band is placed immediately after the previous one (cumulative layout):

| # | Outcome | Driver differential |
|---|---------|---------------------|
| 1 | **HR** | Power − Velocity |
| 2 | **3B** | Speed − Awareness |
| 3 | **2B** | Speed − Awareness |
| 4 | **1B** | Contact − Movement (derived: hit-total minus extra-base hits and IF1B) |
| 5 | **IF1B** | Speed − Awareness |
| 6 | **BB** | Eye − Command |

### Back half (out outcomes) — separate ticket

The remainder of the 0–499 range (after BB) is the **back half**: fly-outs (FO), pop-outs (PO), ground-balls (GB), and strikeouts (K). This is the **elastic** half — it absorbs whatever space the front half doesn't use, so the partition always covers 0–499 exactly.

---

## Attribute differentials

Each width is a function of a single **differential** — the batter's attribute minus the pitcher's attribute, clamped to **[−5, +5]**. The width tables (`seedTables.ts`) have 11 entries indexed by `diff + 5` (so index 0 = diff −5, index 5 = diff 0, index 10 = diff +5).

A positive differential means the batter has the edge on that matchup axis; a negative differential favors the pitcher.

---

## RangeFinder — assembly

The **front-half assembler** (`assembleFrontHalf`) takes the four differentials and returns an object of named bands, each with `{lo, hi}` boundaries (inclusive). The assembler is:

- **Deterministic**: same inputs always produce the same bands.
- **Self-contained**: no I/O, no randomness, no clock.
- **Injectable**: the accessor functions are a parameter so unit tests can freeze the tables without touching `seedTables.ts`.

---

## "The sheet"

Informal term for the private BBTN workbook (`Copy of BBTN 3.12.9 TYGEN 2 Runners.xlsx`). It is the **reference for understanding structure**, not a source we copy. Our seed tables are independently derived from public MLB rate baselines (see `seedTables.ts` provenance header). The parity lane in `frontHalf.test.ts` (skipped in CI) optionally compares our assembler output against captured sheet values to confirm structural equivalence.

---

## Key files

| Path | Purpose |
|---|---|
| `packages/engine/src/tables/seedTables.ts` | Width tables (OutcomeTable arrays, 11 entries each) |
| `packages/engine/src/tables/accessor.ts` | Typed accessors: `getHr`, `getBb`, `getSingle`, etc. |
| `packages/engine/src/rangeFinder/frontHalf.ts` | Front-half assembler (`assembleFrontHalf`) |
| `packages/engine/reference/` | Gitignored local parity fixtures (never committed) |
| `docs/engine/attribute-normalization.md` | How MLB stats → 1–5 attributes |
| `docs/adr/0006-*` | IP & data-sourcing rules |
