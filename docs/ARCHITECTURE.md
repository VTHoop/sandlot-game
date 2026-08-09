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

**Resolution model:** the RangeFinder — takes attribute differentials, looks up each outcome band's width from a table, and assembles them into a 0–499 partition. Band order: `HR → 3B → 2B → 1B → IF1B → BB → FO → PO → GB → K`. Front half (HR→BB) is a cumulative sum of direct table lookups. Back half (FO/PO/GB/K) is an elastic remainder. The top-level `resolveAtBat` (`src/atBat/`) folds the two committed numbers into a 0–499 difference (circular distance on a ring of 999, ADR-0016), classifies the band, and applies that band's runner movement to produce the complete at-bat outcome. `applyOutcome` is the primitive that maps each band to its own movement — `HR` clears the bases (scoring every runner plus the batter), `3B`/`2B` are extra-base hits, `1B`/`IF1B` push runners up one base, `BB` advances only the runners a new runner on first forces, and `FO`/`PO`/`GB`/`K` record an out — and is the fallback the sub-resolutions below refine. The `GB` band sub-resolves further (SAN-16/ADR-0019): gated by base state + outs and sized by the speed−awareness axis, it partitions into a ground-out / fielder's-choice / double-play / triple-play family (`GroundBallResult`), with third-out run suppression. The `1B` / `2B` / `FO` / `IF1B` bands sub-resolve their *runner movement* (SAN-17/ADR-0021, `src/atBat/advancement/`): well-hit extra-base advancement on a hit (one all-or-nothing roll off the average runner speed, advancing every runner one extra base = two-out advancement, §2.6.15), fly-out movement (runner on 3rd scores on any fly with < 2 outs; a deep fly also tags 2nd→3rd, §2.6/§2.6.1), and the forced/2-out infield single (§3.3). All deterministic in the folded space — no RNG, no schema change, and `emit-grid` is unaffected since band rates are unchanged.

**Table structure:** each committed seed table is an 11-element `readonly` tuple indexed by attribute differential `[−5..+5]`. Width values at `diff=0` are anchored to 2024 public MLB league-average rates (`rate × 500`). Differential scaling is monotonic; exact values are rough seeds, tuned by SAN-15 via the Monte Carlo harness.

| path (relative to `packages/engine/`) | purpose |
|---|---|
| `src/tables/seedTables.ts` | Committed seed width tables (HR, 3B, 2B, IF1B, BB, hit-total, K, HandSwitcher SAME/OPPOSITE) with provenance header |
| `src/tables/accessor.ts` | Typed per-outcome accessors; single source of truth for differential clamping to `[−5,+5]` |
| `reference/` | **Gitignored.** Local parity fixtures captured from the private workbook via `scripts/captureParity.py`. Never committed (ADR-0006). |
| `scripts/` | **Gitignored.** The openpyxl capture script. Never committed (ADR-0006). |

**TypeScript compilation:** `packages/engine/tsconfig.json` (composite, `lib: ["ES2022"]`) is a TypeScript project reference — `tsc -b` type-checks the engine under its own lib before building the app. DOM APIs and JSX fail at the engine boundary. The root Vitest config scans engine tests directly (bundler mode, no project references).

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
| `convex/gameView.ts` | The secret-safe live game read model (SAN-56): `getGame` — a discriminated union on status (`scheduled` \| `live` \| `final`) so no screen can read a seat off a finished game. Absolute home/away scores + log-derived hit totals plus the caller's club and seat (the client flips to "you"/"them"); seats and on-base runners resolved to `{ id, name }` (+ the attribute block on the two seats). Deliberately separate from `game.ts` (authoritative writer, no client read path) and structurally unable to reach `duelCommitments` — it takes two booleans from `atBat.duelLocks`. Non-participant / unauthenticated / unknown id are indistinguishable `null`s |
| `convex/participants.ts` | Shared Clerk-auth + team-ownership helpers (`authedUser`, `ownsTeam`, `teamsForHalf`, …) reused by `atBat.ts` and `game.ts` |
| `convex/users.ts` | Account provisioning (SAN-55/ADR-0023): `provision` — the argument-free mutation that turns a Clerk session into the `users` row every gated function resolves against, for the client to call at sign-in (that wiring is SAN-38's). `upsertUserBySubject` is the only place a `users` row is created (the dev seed calls it too); `displayName` is derived from the Clerk identity once and never re-synced |
| `convex/clubs.ts` | Self-serve club claiming (SAN-63/ADR-0024) — the browser-reachable half of becoming a participant: `availability` (a public query answering the caller's *status* rather than throwing at a caller who has none — `unauthenticated` (no identity **or** no `users` row) / `available` / `holding` / `none_left` — exposing `{ id, name }` per club and nothing more) and `claim({ team })` (names the club only; the recipient is always `ctx.auth`). A club is claimable exactly when the seed owner holds it, so a deployment the seed never ran on offers nothing; one club per user is enforced here, on the only path a real user can drive |
| `convex/seed.ts` | Dev-only fixture seed (SAN-54, split in SAN-61): `bootstrapDevLeague` stands up a scheduled game `startGame` can open — one synthetic owner, two clubs, ten players a side, two lineups — and `mintDevGame({ homeTeam, awayTeam })` appends further games from two ids alone, asking nothing about ownership so it survives a club being claimed. `assignClubToUser({ team, clerkSubject })` (SAN-62) performs that claim: it re-points one club at an already-provisioned real account, which is what makes a signed-in human a game participant. Double-fenced: `internalMutation`s (unreachable from any client) gated on `SANDLOT_DEV_SEED=true` (fail-closed). Additive per run — the roster is reused, a new game appended |
| `convex/seedRoster.ts` | The two invented clubs the seed fields — names, nine distinctly-positioned batters, and one arm each. Data only; no MLB names or statistics (ADR-0006). Server-side sibling of `src/design/duel/roster.ts` |
| `packages/engine/src/game/` | Pure game-envelope state machine (SAN-21/ADR-0017): `startGame` + `advance` (current state + resolved at-bat → next state), `REGULATION_INNINGS = 6`, half/inning flips, walk-off / extra-innings end conditions, idempotent per at-bat |
| `convex/validators.ts` | Shared `v.union` field validators (outcome bands, the nullable GB `groundBallResult` sub-result, the `swingType` declaration + nullable `buntResult` sub-result (SAN-17), role, position, game status, half, 1–5 rating, runner-aware base state — `Id<'players'>`-or-null per base, attribute blocks); `outcomeBand`, `groundBallResult`, `swingType`, and `buntResult` are compile-time-locked to `@sandlot/engine` |
| `convex/auth.config.ts` | Clerk OIDC provider so Convex validates Clerk JWTs |
| `packages/engine/src/outcomes.ts` | Canonical at-bat outcome band keys (`OUTCOME_BAND_KEYS`, `OutcomeBandKey`) derived from the RangeFinder bands — single source of truth mirrored by the Convex `atBats.outcome` enum — plus `isHitBand`, which bands count as a base hit (a rule of the game, so it sits with the bands rather than with whichever consumer asked first) |
| `packages/engine/src/atBat/` | Top-level resolver: `foldDifference` (ring-999 circular fold), `classify` (outcome + elastic GB band), `applyOutcome` (identity-preserving per-band primitive advancement — each band moves runners its own way — over a runner-aware `BaseState`, ADR-0018), `groundBall/` (the GB sub-resolution — eligibility × speed-driven sub-band partition → `GroundBallResult`, with third-out run suppression, SAN-16/ADR-0019), `advancement/` (extra-base/deep-fly/sac-fly + forced/2-out infield single, SAN-17/ADR-0021), `bunt/` (the bunt swing-mode sub-resolution — eligibility × partition → `BuntResult`, bypassing the band stack, with third-out run suppression, SAN-17/ADR-0021), and `resolveAtBat` — the dual-use authoritative resolution (ADR-0016) |
| `public/manifest.webmanifest` | PWA manifest (served as-is; `vite-plugin-pwa` handles SW) |
| `pnpm-workspace.yaml` | pnpm 11 build-script approvals (`allowBuilds`) |
| `.env.example` | Required env var names with no real values |

## Environment variables

| Variable | Where set | Purpose |
|---|---|---|
| `VITE_CONVEX_URL` | `.env.local` (written by `npx convex dev`) | Convex deployment URL for the browser client |
| `VITE_CLERK_PUBLISHABLE_KEY` | `.env.local` | Clerk publishable key |
| `CLERK_ISSUER_URL` | Convex dashboard / `npx convex env set` | Clerk Frontend API URL for `convex/auth.config.ts` |
| `SANDLOT_DEV_SEED` | Convex dashboard / `npx convex env set` — **dev deployments only** | Opt-in gate for `convex/seed.ts`. The seed refuses to run unless this is exactly `"true"`, so an unset variable (the default everywhere) blocks it |
