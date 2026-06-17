# Abstractions

## ConvexReactClient

Singleton instantiated once in `src/main.tsx` using `VITE_CONVEX_URL`. Provides
reactive query subscriptions and mutation callers to the React tree via context.
Never instantiate more than one per app.

## ConvexProviderWithClerk

From `convex/react-clerk`. Bridges Clerk's `useAuth` hook into Convex's auth layer.
When a Clerk session is active, every Convex server function receives a validated
`ctx.auth` object. When no session exists, `ctx.auth` is `null`.

Usage: pass the same `useAuth` imported from `@clerk/react` — the provider handles
token refresh and expiry transparently.

## ClerkProvider

Wraps the entire tree so Clerk session state is available everywhere. Must be the
outermost provider (wraps `ConvexProviderWithClerk`). Configured with
`VITE_CLERK_PUBLISHABLE_KEY`.

## UI foundation (`src/components/ui/`)

Extracted from the at-bat duel design spike (ADR-0011/0012,
`docs/design/design-principles.md`). All user-facing UI composes these — no raw HTML
form controls in screens:

- **`Button`** — variants: `consequence` (the one decisive act per screen),
  `surface`, `ghost`. Defaults to `type="button"`.
- **`ScoreTile`** — scoreboard tile for any committed/displayed number.
- **`ScoreTileInput`** — the only input for duel numbers (ADR-0014): styled
  `inputMode="numeric"` tile driven by the device keyboard (strips non-digits and
  leading zeros, caps at 4; validity lives in `src/design/duel/duelNumber.ts`).
- **`OutcomeLadder`** — fixed best→worst outcome strip; keys mirror the engine's
  band names (`HR…K`); `highlight` marks a resolved outcome. Commit screen only
  (ADR-0013/0014).
- **`Scoreboard`** — runs/hits/inning/outs strip; values split-flap tick
  (amber→chalk) on change. Commit, reveal, and waiting screens.
- **`AttributePips`** — 1–5 attribute rating rendered as chalk pips.
- **`Card`** — surface panel for grouped content.

Reveal choreography is Motion-driven (`motion` v12, ADR-0013) with situational drama
pacing derived in `src/design/duel/scenario.ts` (pure, unit-tested).

Components style themselves exclusively from semantic `@theme` tokens in
`src/styles/app.css`; raw hues and Tailwind stock colors are forbidden.

## Convex data model (`convex/schema.ts`)

The multiplayer schema follows ADR-0004 — **authoritative current-state rows +
an append-only log + maintained rollups**, not full event sourcing:

- **State rows:** `games` (inning/half/outs/base-state/score/status/current
  batter+pitcher, plus each team's persisted batting-order pointer and the
  applied-at-bat marker — see *Game state machine* below) and `lineups` (ordered
  1–9 batting list + designated pitcher).
- **`duelCommitments` — symmetric secret vault.** Each side's committed number
  (pitch or swing) lives only here, in its own table by design, so no public/
  at-bat read path can reach it (game-integrity rule). Commits are
  order-independent (ADR-0014): a row is keyed `(game, sequence, role)` and the
  server resolves once both roles are present. The "opponent cannot read your
  number before both lock" test is owned by the Secret at-bat round-trip ticket.
- **`atBats` — append-only log.** Each row carries complete pre- and post-state
  (outs/bases before & after, both committed numbers, outcome, runs, RBI) so
  entries are never mutated. Ordered within a game by `sequence` (`by_game`).
- **Rollups:** `standings`, `playerStatLine` (engine `SlashLine` inputs),
  `boxScoreLine` — maintained aggregates kept in sync with the log by later
  tickets, never aggregated from raw events on the client.

Mutations, queries, rollup maintenance, append-only enforcement, secrecy
read-paths, and salary-cap logic are **not** in this layer — they belong to
downstream Multiplayer/League tickets. This is schema only.

### Shared validators (`convex/validators.ts`)

Every enumerated domain is defined once as a `v.union` of literals and reused:
outcome bands, role, position, game status, half-inning, the 1–5 attribute
`rating` (a literal union, so the bound is a schema-level guarantee), base state,
and the hitter/pitcher attribute blocks. No `v.any()` anywhere.

The `outcomeBand` enum **mirrors the engine** (`HR…K`): a compile-time guard ties
it to `OutcomeBandKey` from `@sandlot/engine/outcomes`, so the persisted outcome
enum can never drift from what the RangeFinder produces. The engine is the single
source of truth; the import is type-only, so the Convex bundle carries no engine
runtime dependency.

## Game state machine (`@sandlot/engine/game` + `convex/game.ts`)

The authoritative live game envelope (SAN-21, ADR-0017). The **rules** are a pure
engine module: `startGame(context)` seeds a live state from the lineups, and
`advance(state, resolvedAtBat, context, config?)` folds one resolved at-bat into
the next state — applying the recorded run/out/base deltas, advancing the batting
team's order pointer (persists per team across half-innings), flipping
half-innings / innings on the third out, and resolving end-of-game over a
**6-inning regulation** (`REGULATION_INNINGS = 6`): walk-off short-circuit, home
already leading after the top of the final inning, regulation final, and
tie → extra innings. It is pure, deterministic, exhaustively unit-tested, and
idempotent per at-bat (an at-bat at or behind `lastResolvedSequence` is a no-op).
The "who bats / who fields this half" rule is factored into a small `HalfInning`
model (`halfInning(half, context)`) so the transition never re-derives offense vs.
defense at each score / pointer / seating step.

`convex/game.ts` is the thin Convex boundary — it computes none of the rules:

- **`startGame`** — a participant-gated mutation (home/away owner, `scheduled`
  only) that maps the engine's seed state onto the `games` row.
- **`applyResolvedAtBat`** — *not* client-callable; called from the secret
  round-trip's resolution (`atBat.ts`) within the **same transaction** as the
  `atBats` append, so the log and the live row never diverge (ADR-0004).

**Client-write invariant:** the live games-state fields move only through these
two server paths. No client mutation writes them directly — the same vault
discipline as the secret pitch, extended to the whole envelope.

---

_Components, hooks, and game-logic abstractions are added here as they land._
