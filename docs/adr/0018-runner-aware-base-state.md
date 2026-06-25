# 18. Runner-aware base state (per-base player references)

- Status: Accepted
- Date: 2026-06-25

## Context

The base state was an occupancy snapshot — `{ first, second, third }: boolean`
in both the engine (`BaseState`) and the persisted Convex `baseState` validator
(`games.bases`, `atBats.basesBefore`, `atBats.basesAfter`). It recorded *that* a
base was occupied, not *who* stood on it.

Every player attribute is already modeled, but **speed is the only one with a
second life on the basepaths** — the other seven are consumed solely in the
batter-vs-pitcher duel and never need to persist on the field. With occupancy-only
bases, an on-base runner's stored speed is unreachable: there is no id to look the
runner up by.

The next at-bat ticket (SAN-16, ground-ball sub-resolution) drives its
fielder's-choice / double-play split from every on-base runner's speed — lead
**and** trailing — plus the batter's. The §3 baserunning tickets (steals, hit &
run, tag-ups) need the same identity rail. Doing a half-version inside SAN-16
would bury a persisted-schema migration in a balance ticket, so the rail lands
first, on its own, behavior-preserving.

This is a data-model change to the persisted `games`/`atBats` shape, which
ADR-0004 (append-only log + authoritative state) makes an architectural decision.

## Decision

**Each base references the runner standing on it, not a boolean.**

- **Engine** (`@sandlot/engine/atBat`): `BaseState` becomes
  `{ first, second, third }: RunnerId | null`, where `RunnerId` is an opaque
  string — the same opaque-string convention the engine already uses for the
  batter/pitcher (ADR-0009). The engine never inspects the id. `EMPTY_BASES`
  (`{ first: null, second: null, third: null }`) is exported from the at-bat
  module and reused by the game transition (single source).
- **Advancement is identity-preserving.** The existing advancers
  (HR/3B/2B/1B/IF1B/BB and the FO/PO/GB/K out path) move the same runner ids
  between bases instead of re-deriving occupancy, and `applyOutcome` /
  `resolveAtBat` take the **batter's** id (sourced at the Convex boundary from
  `games.currentBatter`) to seat it as a new on-base runner on reaching base.
  Scored runners' ids drop off (derivable from the play, not persisted here).
- **Persisted validator** (`convex/validators.ts`): `baseState` becomes
  `v.union(v.id('players'), v.null())` per base, applied to `games.bases`,
  `atBats.basesBefore`, and `atBats.basesAfter`. The engine `BaseState` stays the
  single source of truth; the Convex layer maps its `Id<'players'>` onto the
  opaque string at the boundary — exactly as `currentBatter` / `currentPitcher`
  already do (a typed relabel, never a value remap). A runtime mirror test ties
  the validator's base field set to the engine `BaseState` (the twin of the
  boundary cast and of the `outcomeBand ↔ OUTCOME_BAND_KEYS` discipline).

**Behavior-preserving.** No outcome changes: projecting the runner-aware state
back to `{ first, second, third }: boolean` reproduces the prior occupancy for
every scenario (the keystone regression test), and all harness aggregates (rates,
slash line, runs/game) are unchanged — GB still resolves as a plain out. No runner
attribute is consumed in this change; it only establishes the references.

**No data migration.** Pre-launch — no production `games`/`atBats` rows exist, so
the shape change needs no backfill.

## Alternatives considered

- **Embed runner attributes (e.g. `{ id, speed }`) on the base.** Rejected: it
  duplicates player state onto the field and diverges from the established
  player-reference pattern (`currentBatter`/`currentPitcher`). Ids only; the
  Convex boundary supplies looked-up attributes when a ticket needs them (ADR-0009
  keeps the engine roster-free).
- **Track only the lead runner's identity.** Rejected: SAN-16's FC/DP split needs
  the trailing runner's speed too, so every base must be individually reachable.
- **Defer to SAN-16.** Rejected: it would hide a persisted-schema migration inside
  a balance ticket and re-open it for the §3 baserunning tickets. Foundation first.

## Consequences

- **+** An on-base runner's stored speed (and any future on-field attribute) is
  reachable by id — the shared rail SAN-16 and §3 baserunning consume.
- **+** Behavior-preserving and fully covered: occupancy-projection equivalence is
  the regression keystone; the live row and the log round-trip ids identically.
- **+** One opaque-string convention across batter, pitcher, and runners; the
  Convex boundary stays a thin typed relabel.
- **−** `applyOutcome` / `resolveAtBat` gain a required `batter` argument, and the
  Convex boundary carries one more cast (bases) alongside the player-ref casts.
- **−** Which runners *scored* is derivable but not yet persisted (RBI
  attribution is a later ticket); the bases carry only who remains on field.
