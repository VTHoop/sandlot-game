# CONTEXT — start here

Orientation for any human or agent opening this repo. **`AGENTS.md` is the working contract (the *how*); the ADRs are the *why*; this file says where everything lives.**

## What this is
**Sandlot** (working name; brand "Sandlot ___" TBD) — a turn-based, async-first multiplayer baseball game. Core mechanic: a **hidden-number duel** — the pitcher submits a secret number (1–999), the batter submits one, and the server resolves the outcome by how close they are (circular distance on a ring of 999; see ADR-0016), with player **attributes (1–5)** resizing the outcome bands. Wrapped in a **salary-cap league** where you draft real, stat-derived MLB players plus one custom "signature" player. First milestone: a **6-team family-league beta**. It's also a **public portfolio piece** — optimize for *visible judgment* (the ADRs), and **ship the vertical slice**.

## Where the reasoning lives
- **`AGENTS.md`** / `CLAUDE.md` — the engineering contract: TDD, PR flow, quality gates, product rules. Read first.
- **`docs/adr/`** — every significant decision and its rationale (stack, data model, client, process, IP).
- **`docs/ROADMAP.md`** — initiative → projects → issues, with build order. `docs/linear-import.csv` imports it into Linear.
- **Design narrative (outside the repo, in this machine's memory):** `/Users/hoop/.claude/projects/-Users-hoop-dev/memory/` — `bbtn-game-concept`, `bbtn-poc-plan`, `bbtn-attribute-normalization`, `bbtn-engine-extracted`, `sandlot-foundation` (indexed in `MEMORY.md`). These hold the product/design "why" that predates this repo.

## Build references
- **At-bat model (vocabulary & structure):** `docs/engine/at-bat-model.md` — what *RangeFinder*, *outcome bands*, *front/back half*, and *"the sheet"* mean. Start here before reading any engine ticket. Structure only, IP-safe.
- **Attribute system:** `docs/engine/attribute-normalization.md` (in-repo, safe to commit — derived from *public* MLB distributions).
- **Design spike brief:** `docs/design/spike-prompt.md` — self-contained prompt for handing the at-bat-duel UI/UX design to a high-capability model in its own session. Two research-backed sign-off gates (styling substrate, then visual direction), each ADR'd; outputs a design-principles doc + parked `/design` route. Not yet executed.
- **Decoded at-bat engine:** `/Users/hoop/dev/bbtn-engine-spec.md` — ⚠️ **PRIVATE, do NOT commit** (it contains the reverse-engineered source calculator's verbatim tables; see ADR-0006). Use it locally to understand the engine's *structure*, then **re-derive the numbers via simulation** for what ships.
- **Source material (private, on disk):** `/Users/hoop/Downloads/Copy of BBTN 3.12.9 TYGEN 2 Runners.xlsx` (the calculator) and `…/Official Baseball by the Numbers Rules and Guidelines (Version 1).txt` (the rules).

## Cardinal rules (full text in the ADRs)
- **Game integrity (ADR-0004 + AGENTS.md):** the pitch is secret — written by a Convex mutation, never returned by any client query before the swing locks. Add a test that asserts the batter can't read it.
- **IP & data (ADR-0006):** use the *mechanic*, not the original brand/text/tables. **Never commit MLB data** to this public repo. Re-derive balance; credit `r/baseballbythenumbers` as inspiration.

## Where to start building
`docs/ROADMAP.md`, critical path: **Engine → secret at-bat round-trip → data pipeline → roster/cap → league → UX.** The first unblocked move (no external accounts) is the pure-TS at-bat engine: port the RangeFinder front half (HR→BB) with unit tests, then the elastic back half, then the Monte Carlo harness. New to these terms? Read `docs/engine/at-bat-model.md` first.
