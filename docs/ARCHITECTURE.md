# Architecture

## Tech stack

| Layer | Choice | Notes |
|---|---|---|
| Client | React 18 + Vite 8 PWA | Mobile-first; hosted on Cloudflare Pages |
| Backend / data / realtime | Convex | Mutations, queries, scheduled functions |
| Auth | Clerk | JWT template → `ctx.auth` in server functions |
| Engine | `@sandlot/engine` (pnpm workspace, `private: true`) | Pure TS; no framework deps. Imported by Convex server functions (authoritative resolution) **and** the React client (read-only odds/near-miss previews). One package, two deployment contexts — see ADR-0009. |
| Package manager | pnpm 11 | Node 24; `pnpm-workspace.yaml` for build approvals |

See `docs/adr/` for the "why" behind each choice.

## Provider tree

```
ClerkProvider                     (Clerk session + JWT)
  └─ ConvexProviderWithClerk      (passes Clerk JWT into Convex auth layer)
       └─ App
```

`ConvexProviderWithClerk` is from `convex/react-clerk`. It receives Clerk's `useAuth`
hook and forwards a validated token to every Convex server function as `ctx.auth`.

## Engine package (`@sandlot/engine`)

Located at `packages/engine/`. A pure, framework-free TypeScript package — no React, no Convex SDK, no DOM.

**Dual-use deployment:** Convex server functions import it as the authoritative at-bat resolver (mutations are the secret vault). The React client imports it for read-only odds and near-miss previews. One engine, two contexts.

**Resolution model:** the RangeFinder — takes attribute differentials, looks up each outcome band's width from a table, and assembles them into a 0–499 partition. Band order: `HR → 3B → 2B → 1B → IF1B → BB → FO → PO → GB/GO → K`. Front half (HR→BB) is a cumulative sum of direct table lookups. Back half (FO/PO/GB/K) is an elastic remainder. The top-level `resolveAtBat` (`src/atBat/`) folds the two committed numbers into a 0–499 difference (circular distance on a ring of 999, ADR-0016), classifies the band, and applies standard one-base advancement to produce the complete at-bat outcome.

**Table structure:** each committed seed table is an 11-element `readonly` tuple indexed by attribute differential `[−5..+5]`. Width values at `diff=0` are anchored to 2024 public MLB league-average rates (`rate × 500`). Differential scaling is monotonic; exact values are rough seeds, tuned by SAN-15 via the Monte Carlo harness.

| path (relative to `packages/engine/`) | purpose |
|---|---|
| `src/tables/seedTables.ts` | Committed seed width tables (HR, 3B, 2B, IF1B, BB, hit-total, K, HandSwitcher SAME/OPPOSITE) with provenance header |
| `src/tables/accessor.ts` | Typed per-outcome accessors; single source of truth for differential clamping to `[−5,+5]` |
| `reference/` | **Gitignored.** Local parity fixtures captured from the private workbook via `scripts/captureParity.py`. Never committed (ADR-0006). |
| `scripts/` | **Gitignored.** The openpyxl capture script. Never committed (ADR-0006). |

**TypeScript compilation:** `packages/engine/tsconfig.json` (composite, `lib: ["ES2020"]`) is a TypeScript project reference — `tsc -b` type-checks the engine under its own lib before building the app. DOM APIs and JSX fail at the engine boundary. The root Vitest config scans engine tests directly (bundler mode, no project references).

## Key files

| Path | Purpose |
|---|---|
| `src/main.tsx` | Entry point — wires ClerkProvider + ConvexProviderWithClerk; imports `src/styles/app.css` |
| `src/App.tsx` | Root component; also gates the parked, code-split `/design` showcase route (URL-only, never in nav) |
| `src/styles/app.css` | Tailwind v4 entry: semantic `@theme` design tokens (Night Game, ADR-0012) + base styles |
| `src/components/ui/` | Foundation components extracted from the duel (Button, ScoreTile, NumberPad, OutcomeLadder, Card) — see `docs/design/design-principles.md` |
| `src/design/` | Design-spike showcase: duel screens for all four states + `duel.css` reveal choreography |
| `convex/schema.ts` | Convex data model (SAN-19): `users`, `teams`, `players`, `games`, `lineups`, `duelCommitments` (symmetric secret vault, keyed by `(game, sequence, role)` — SAN-20/ADR-0016), `atBats` (append-only log), and the `standings`/`playerStatLine`/`boxScoreLine` rollups — per ADR-0004. `games` carries the live envelope plus each team's persisted batting-order pointer (`homeBattingIndex`/`awayBattingIndex`) and the applied-at-bat marker (`lastResolvedSequence`) for SAN-21 |
| `convex/atBat.ts` | The authoritative secret at-bat round-trip (SAN-20): `commitPitch` / `commitSwing` (order-independent vault — either side may lock first, ADR-0014 — resolving via `@sandlot/engine` + appending the complete `atBats` row once both land, then folding it into the live `games` row via `game.applyResolvedAtBat` in the same transaction — SAN-21), and `getActiveDuel` (gated reveal — no number leaves the vault until both sides lock; non-participants get `null`) |
| `convex/game.ts` | Authoritative game-state mutations (SAN-21): `startGame` (scheduled → live, participant-gated, seeded from lineups) and `applyResolvedAtBat` (folds each resolved at-bat into the `games` row via the pure engine transition). The live games-state fields are written only here — never by a client (ADR-0017) |
| `convex/participants.ts` | Shared Clerk-auth + team-ownership helpers (`authedUser`, `ownsTeam`, `teamsForHalf`, …) reused by `atBat.ts` and `game.ts` |
| `packages/engine/src/game/` | Pure game-envelope state machine (SAN-21/ADR-0017): `startGame` + `advance` (current state + resolved at-bat → next state), `REGULATION_INNINGS = 6`, half/inning flips, walk-off / extra-innings end conditions, idempotent per at-bat |
| `convex/validators.ts` | Shared `v.union` field validators (outcome bands, role, position, game status, half, 1–5 rating, runner-aware base state — `Id<'players'>`-or-null per base, attribute blocks); `outcomeBand` is compile-time-locked to `@sandlot/engine/outcomes` |
| `convex/auth.config.ts` | Clerk OIDC provider so Convex validates Clerk JWTs |
| `packages/engine/src/outcomes.ts` | Canonical at-bat outcome band keys (`OUTCOME_BAND_KEYS`, `OutcomeBandKey`) derived from the RangeFinder bands — single source of truth mirrored by the Convex `atBats.outcome` enum |
| `packages/engine/src/atBat/` | Top-level resolver: `foldDifference` (ring-999 circular fold), `classifyOutcome`, `applyOutcome` (identity-preserving one-base advancement over a runner-aware `BaseState`, ADR-0018), and `resolveAtBat` — the dual-use authoritative resolution (ADR-0016) |
| `public/manifest.webmanifest` | PWA manifest (served as-is; `vite-plugin-pwa` handles SW) |
| `pnpm-workspace.yaml` | pnpm 11 build-script approvals (`allowBuilds`) |
| `.env.example` | Required env var names with no real values |

## Environment variables

| Variable | Where set | Purpose |
|---|---|---|
| `VITE_CONVEX_URL` | `.env.local` (written by `npx convex dev`) | Convex deployment URL for the browser client |
| `VITE_CLERK_PUBLISHABLE_KEY` | `.env.local` | Clerk publishable key |
| `CLERK_ISSUER_URL` | Convex dashboard / `npx convex env set` | Clerk Frontend API URL for `convex/auth.config.ts` |
