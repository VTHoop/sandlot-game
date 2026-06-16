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
  batter+pitcher) and `lineups` (ordered 1–9 batting list + designated pitcher).
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

---

_Components, hooks, and game-logic abstractions are added here as they land._
