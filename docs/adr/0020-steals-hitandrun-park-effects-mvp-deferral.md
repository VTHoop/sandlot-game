# 20. Steals, Hit & Run, and Park effects deferred from the MVP

- Status: Accepted
- Date: 2026-06-26

## Context

SAN-17 ports the remaining single-at-bat workbook modules — Bunts (Rules §3.4)
and Extra-base / Deep-fly advancement (Rules §3.2/§3.3) — into the deterministic,
roster-free engine (ADR-0009), alongside the ground-ball sub-resolution already
landed in ADR-0019. Three workbook modules deliberately stay un-ported for the
MVP: **Steals**, **Hit & Run**, and **Park effects** (the Steals / Park Effects /
Parks tabs).

These three do not fit the single-at-bat resolution frame the engine is built
around:

- **Steals** (Rules §3.1) are a *pre-pitch* action: a baserunning decision
  resolved against a submitted steal number, independent of the pitch-vs-swing
  duel. The outcome mutates base state before — or instead of — an at-bat, so it
  belongs to the turn/inning loop, not to `resolveAtBat`.
- **Hit & Run** (Rules §3.2) is, mechanically, a steal-number submission coupled
  to a swing — it inherits the same pre-pitch baserunning seam as a steal.
- **Park effects** scale or offset outcome bands by ballpark. The engine has no
  ballpark concept and consumes only the four attribute differentials; introducing
  one is a data-model change, not an engine-math change.

The MVP's goal is to prove the core duel loop is fun (ROADMAP P0). Aggregate
run-environment believability — the gate that would validate steal rates and park
factors — is deferred together with the game-loop work; the current Monte Carlo
harness models at-bat outcome *rates*, not baserunning, so it cannot gate these
effects today (this is also why SAN-17 adds no harness gate for bunt/advancement
run movement).

## Decision

**Defer Steals, Hit & Run, and Park effects from the MVP.** Port none of the
Steals / Park Effects / Parks tabs now. Record the seam each will need so the
deferral is actionable rather than forgotten.

### Seam 1 — a baserunning / game-loop hook (Steals + Hit & Run)

Steals and Hit & Run are resolved by a **pre-pitch baserunning action** in the
authoritative game-state machine (ADR-0017), *not* in `resolveAtBat`:

- A steal is a submitted steal number resolved against a defensive number
  (the same hidden-number-duel shape as the at-bat, but over base state), producing
  SAFE/OUT and a base/out mutation, committed through a mutation like any other
  state write (the server stays the vault and referee).
- Hit & Run layers that steal submission onto a normal swing: the runner goes on
  the pitch, then the at-bat resolves; the engine's single-at-bat resolution is
  reused unchanged, with the baserunning hook wrapping it.
- The engine stays roster-free and deterministic: runner identities/speeds keep
  arriving as caller-supplied inputs (ADR-0009), exactly as the GB and SAN-17
  advancement layers already consume `runnerSpeeds`.

### Seam 2 — a ballpark concept in the data model (Park effects)

Park effects need a **per-game ballpark handle** in the data model (a `parks` slot
referenced by `games`), surfaced to resolution as a small set of band
scale/offset factors. This keeps the effect a *deterministic input adjustment* —
the same discipline as SAN-17's "bunt bonus" (an input raise, not engine RNG) —
rather than new randomness inside the engine. Until that data-model slot exists,
park factors have nowhere to live, so the port waits on it.

## Consequences

- **+** The MVP ships the complete single-at-bat resolution surface (RangeFinder +
  GB + bunts + extra-base/deep-fly) without taking on baserunning or ballpark
  scope that the harness cannot yet validate.
- **+** The two seams are named while fresh, so steals/H&R land as a game-loop
  feature and park effects as a data-model + input-adjustment feature — neither
  forces engine RNG or breaks the roster-free contract (ADR-0009).
- **−** Until the baserunning hook exists, the simulated game cannot steal or hit-
  and-run, and run environments will run slightly low versus a real game that
  includes steals. Acceptable for a family-league POC.
- This ADR **extends** ADR-0006/0009/0017 rather than superseding any: all data-
  hygiene, roster-free, and authoritative-state rules remain in force.
