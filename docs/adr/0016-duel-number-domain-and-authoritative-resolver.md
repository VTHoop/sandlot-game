# 16. Duel-number domain (ring of 999) + the authoritative at-bat resolver

- Status: Accepted
- Date: 2026-06-15

## Context

SAN-20 implements the first authoritative secret at-bat round-trip: a Convex
mutation vaults the pitcher's number, a second mutation commits the swing and
resolves the duel server-side through `@sandlot/engine`, and the result is
revealed. Building it forced three decisions that are not derivable from the
existing code and that the prior ADRs left open.

**1. The committed-number domain and the fold.** The decoded reference and
earlier docs describe the duel as two numbers in `1–1000` whose circular
distance (`d = |a−b|; 1000−d if d > 500`) folds onto `0–500`. But the shipped
engine deliberately assembles outcome bands over **`0–499` (500 positions,
`K.hi = 499`)** so that `rate = band_width / 500` is an *exact* analytic
identity — the foundation of the SAN-14/15 balance harness (ADR-0010). A
`1000`-ring is even, so it has an antipode: difference `500` is reachable (e.g.
`1` vs `501`) and has nowhere to land in a `0–499` partition, and the fold
produces `501` values with *two* half-weight endpoints (`0` and `500`).

**2. Where resolution lives.** ADR-0009 established the engine as the single,
framework-free resolver shared by the server (authoritative) and the client
(read-only preview), but no top-level resolver existed yet.

**3. Base/out advancement.** The AC requires a *complete* `atBats` row
(`runsScored`, `rbi`, `basesAfter`, `outsAfter`), but the GB sub-resolution
(FC/DP/TP), steals, bunts, extra-base (well-hit/deep-fly), and park effects are
all explicitly deferred to later tickets.

## Decision

**Adopt a duel-number domain of `1–999` — a ring of 999 — with the fold
`min(d, 999 − d)`.** An odd ring has **no antipode**: the maximum circular
distance is `(999−1)/2 = 499`, so the fold's output range is *exactly* `0–499`,
matching the engine's band range with no clamp and no value ever landing outside
the assembled partition. Over all `999² = 998 001` ordered `(pitch, swing)`
pairs the interior `1–499` is perfectly uniform (`1 998` pairs each) and only the
exact-match value `0` (→ HR) is half-weight (`999`) — *one* tail instead of the
`1000`-ring's two. This **supersedes the "uniform `1–1000` draws" premise in
ADR-0010**; the `rate = width / 500` identity it relies on becomes strictly more
accurate (one half-weight endpoint, not two). It is also a cleaner UX: every
committed number is at most three digits.

**Put the resolver in `@sandlot/engine` (`./atBat`), per ADR-0009.**
`resolveAtBat({ pitch, swing, hitter, pitcher, basesBefore, outsBefore })` folds
the difference, derives the four `batter − pitcher` differentials (clamped
`[−5,+5]`), classifies via the existing RangeFinder assemblers, and applies the
outcome. The Convex mutation only orchestrates auth, the vault, and the
append — clients never resolve authoritatively.

**Use a "standard one-base advancement" model** for this ticket: hits advance
all runners (HR clears the bases and scores everyone; 3B scores all; 2B scores
2nd/3rd and sends 1st→3rd; 1B/IF1B advance everyone one base); BB pushes only
forced runners (a run scores only with the bases loaded); FO/PO/GB/K record one
out with no runner movement. `rbi = runsScored` (the deferred mechanics — DP,
sac flies, errors — are the only places they diverge). `outsAfter` is recorded
raw and may reach 3; the inning/half/status transition is the Game-state-machine
ticket's job, so resolution appends the `atBats` row and does **not** mutate the
`games` row.

**Key the secret vault by `(game, sequence)`** (the at-bat's pre-resolution
identity), not by an `atBats` id: the pitch is committed before the at-bat is
resolved, and per ADR-0004 + the AC exactly one *complete* `atBats` row is
appended only at resolution, so the vault cannot reference a row that does not
yet exist.

## Alternatives considered

- **Keep `1–1000` and clamp a folded `500` to `499`.** Works, but preserves the
  two-tail asymmetry, allows a four-digit input, and papers over the antipode
  rather than removing it. The odd ring is strictly cleaner.
- **Re-anchor the engine bands to `0–500` (`K.hi = 500`, `RANGE = 501`).**
  Matches the reference's `0–500` example exactly, but reopens the SAN-15 balance
  calibration and the `width/500` identity across the whole engine and its test
  suites — far outside this ticket's scope.
- **Resolve inside Convex.** Rejected by ADR-0009: it would couple game math to
  the Convex SDK and duplicate logic the client needs for previews.

## Consequences

- **+** The fold's output range equals the band range exactly — no clamp, no
  out-of-range case, simpler resolver and tests.
- **+** The balance identity is more accurate (one half-weight endpoint).
- **+** One shared, unit-tested resolver for server and client.
- **−** The committed-number domain changes from the originally-documented
  `1–1000` to `1–999`; the client validator (`DUEL_MAX`), schema comments, and
  prose docs are updated to match (ADR-0010 is superseded, not edited).
- **−** The advancement model is intentionally simplified; the deferred
  mechanics (GB sub-resolution, steals, bunts, extra-base, park effects) will
  layer on in their own tickets and refine `rbi`/runner movement.
