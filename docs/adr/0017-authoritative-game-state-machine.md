# 17. Authoritative game state machine + 6-inning regulation

- Status: Accepted
- Date: 2026-06-17

## Context

ADR-0016 / SAN-20 made the secret at-bat round-trip authoritative: once both
sides commit, the server resolves the duel and appends one **complete** `atBats`
row (`outcome`, `runsScored`, `rbi`, `basesAfter`, `outsAfter`) — but it
deliberately does **not** touch the `games` row. So nothing yet advances the live
game envelope (inning, half, outs, bases, score, whose-turn) or runs the game
lifecycle (scheduled → live → final). SAN-21 owns that, and building it forced
decisions the prior ADRs left open.

**1. Regulation length.** Standard baseball is 9 innings, but the original
`r/baseballbythenumbers` rules never fixed a length for our format, and a
family-league async game wants shorter games. This is a product rule, not
derivable from code.

**2. Where the transition logic lives.** ADR-0009 makes `@sandlot/engine` the
single framework-free home for game *rules*, shared by server and client. The
game envelope is rules, not Convex plumbing.

**3. How state stays consistent and idempotent.** Per ADR-0004 the live row is
authoritative current state updated transactionally with the log — never rebuilt
by replay. We need the batting-order pointer to persist per team across
half-innings, and folding an at-bat to be safe against double application.

## Decision

**A Sandlot game is 6 innings, not 9.** `REGULATION_INNINGS = 6` is the single
source of truth (in `@sandlot/engine/game`), threaded through the end-of-game
logic as a `GameConfig`. (Documented in CONTEXT.md as a first-class game rule.)

**The transition is a pure engine function** in `@sandlot/engine/game`
(`packages/engine/src/game/`): `startGame(context)` seeds a live state from the
lineups, and `advance(state, resolvedAtBat, context, config?)` folds one resolved
at-bat into the next state. Pure, deterministic, and exhaustively unit-tested;
the Convex layer (`convex/game.ts`) only maps the `games` Doc to/from the engine
state, loads lineups, and persists — it computes none of the rules itself.

**Authoritative transitions:**

- **Start (scheduled → live):** inning 1 / top / 0 outs / empty bases / 0–0;
  away team leads off (top of the 1st), home team pitches. Participant-gated
  (home or away owner) and only from `scheduled`.
- **Per at-bat:** apply the recorded deltas (runs to the batting team, the out
  delta, the new base state), advance the batting team's order pointer (wraps,
  persists per team), and re-seat the next batter — folded in the **same
  transaction** as the `atBats` append so the log and the live row never diverge.
- **Third out:** flip half, reset outs, clear bases, swap offense/defense (each
  side resumes at its stored pointer; the new pitcher is the fielding team's).
  top→bottom keeps the inning; bottom→top increments it.
- **End of game (MLB semantics over a 6-inning regulation):** a **walk-off** —
  the home team taking the lead in the bottom of the 6th-or-later — ends the game
  immediately, mid-inning. If the home team **already leads after the top** of
  the 6th-or-later, the bottom half is never played. A completed
  regulation-or-later inning with a leader is `final`; a tie continues into extra
  innings (no run-limit mercy rule). A `final` game rejects further advancement.

**Idempotency via a stored marker.** The `games` row gains
`homeBattingIndex` / `awayBattingIndex` (each team's 0-based order pointer,
persisting across half-innings) and `lastResolvedSequence` (the `atBats.sequence`
last folded in, -1 before any). `advance` treats an at-bat at or behind the
marker as a no-op and rejects an out-of-order one — making "apply each at-bat
exactly once" a real, testable property rather than only an OCC side effect.

**Client-write invariant.** The live games-state fields are mutated **only** by
`startGame` and by the resolution-path fold (`applyResolvedAtBat`, not
client-callable). No client mutation writes them directly.

## Alternatives considered

- **Keep 9 innings.** Rejected: longer async games for a casual family league,
  and the format never committed to 9. 6 is a deliberate product choice.
- **Derive the batting pointer from the at-bat log** (count a team's PAs mod
  lineup length). Rejected by ADR-0004 (don't rebuild state from replay) — an
  O(1) stored pointer is simpler and idempotent.
- **Put the transition in Convex.** Rejected by ADR-0009: the envelope is game
  rules; keeping it pure makes it unit-testable without Convex and reusable by
  the client.
- **A separate client-callable "advance" mutation.** Rejected: it would break the
  log/state atomicity and reopen a client-write path. Folding inside resolution
  keeps both in one transaction.

## Consequences

- **+** One pure, exhaustively-tested transition; Convex is a thin boundary.
- **+** Log and live state are always consistent (same transaction) and
  per-at-bat advancement is idempotent.
- **+** A clear, single client-write invariant for the live row.
- **−** The `games` table grows three fields (`homeBattingIndex`,
  `awayBattingIndex`, `lastResolvedSequence`); every `games` insert must supply
  them.
- **−** End-of-game follows MLB stoppage rules layered on a non-standard 6-inning
  regulation — a deliberate deviation that must be kept in mind when reading the
  rules. Deferred at-bat mechanics (GB sub-resolution, steals, etc., ADR-0016)
  still feed this envelope unchanged.
