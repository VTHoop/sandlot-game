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

## Account provisioning (`convex/users.ts`)

A Clerk session is not an account. Every participant-gated server function
resolves its caller by looking `ctx.auth.subject` up in `users.by_clerk_subject`
(see `convex/participants.ts`), so a `users` row has to exist before a signed-in
user can do anything. `api.users.provision` mints it (SAN-55, ADR-0023) — it is
the one function that creates rather than resolves, and the dev seed reaches the
same upsert by an internal path.

**Explicit, not lazy.** The client is meant to call it at sign-in; that wiring
belongs to SAN-38 and is not in place yet. It cannot be folded into
`maybeUser`/`authedUser`, which accept a `QueryCtx | MutationCtx` — Convex queries
cannot write, so a first-time user would still fail every read, and every gated
mutation would quietly become an account-creation path.

**Self-only and idempotent.** It takes no arguments; the subject comes only from
`ctx.auth`. Returning callers get the same row id back and nothing is written. The
upsert reads the index range it inserts into, so concurrent first-time calls (React
`<StrictMode>` double-invokes effects in dev) conflict under Convex's serializable
OCC rather than producing a second row — which matters because `by_clerk_subject`
is read with `.unique()`, and a duplicate would throw on every later lookup.

**`displayName` is write-once.** Seeded from the Clerk identity by a fallback
chain — full name → username (`nickname` in Clerk's `convex` JWT template) → email
local-part → `"Manager"` — and never re-synced, so a future in-app profile edit
cannot be reverted by the next sign-in. Never empty.

`upsertUserBySubject` is the single place a `users` row is created; the dev seed
(below) is just another caller, holding a subject Clerk cannot issue. Provisioning
grants no team ownership — claiming a club is SAN-62.

Auth itself still lives entirely in `convex/participants.ts`: `provision` takes the
raw identity from `authedIdentity` and the row lookup from `userBySubject` rather
than reading `ctx.auth` or the index itself. That is not tidiness — the OCC
argument above only holds while the range the upsert reads is the same range every
gate reads, and `.unique()`'s throw-on-duplicate has to stay loud in both.

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
  (outs/bases before & after, both committed numbers, outcome, the nullable GB
  `groundBallResult` sub-result, the `swingType` declaration + nullable `buntResult`
  sub-result (SAN-17), runs, RBI) so entries are never mutated. Ordered within a
  game by `sequence` (`by_game`).
- **Rollups:** `standings`, `playerStatLine` (engine `SlashLine` inputs),
  `boxScoreLine` — maintained aggregates kept in sync with the log by later
  tickets, never aggregated from raw events on the client.

Mutations, queries, rollup maintenance, append-only enforcement, secrecy
read-paths, and salary-cap logic are **not** in this layer — they belong to
downstream Multiplayer/League tickets. This is schema only.

### Shared validators (`convex/validators.ts`)

Every enumerated domain is defined once as a `v.union` of literals and reused:
outcome bands, role, position, game status, half-inning, the 1–5 attribute
`rating` (a literal union, so the bound is a schema-level guarantee), the
runner-aware `baseState`, and the hitter/pitcher attribute blocks. No `v.any()`
anywhere.

The `outcomeBand` enum **mirrors the engine** (`HR…K`): a compile-time guard ties
it to `OutcomeBandKey` from `@sandlot/engine/outcomes`, so the persisted outcome
enum can never drift from what the RangeFinder produces. The engine is the single
source of truth; the import is type-only, so the Convex bundle carries no engine
runtime dependency.

`groundBallResult` (SAN-16, ADR-0019) mirrors the engine's `GroundBallResult`
enum the same way — explicit literals locked to `@sandlot/engine/atBat` by a
compile-time guard (the engine type is a string enum, so it is coerced to its
string values for the equality check) and a runtime mirror test. It is recorded
**nullable** on `atBats` (null for every non-GB outcome); the `outcomeBand` stays
`GB`. The persisted band taxonomy is unchanged — this records *which* ground-ball
play a `GB` resolved to.

`swingType` and `buntResult` (SAN-17, ADR-0021) follow the same discipline. A bunt
bypasses the RangeFinder, so its `outcomeBand` is a representative mapping
(bunt-hit/butcher-boy → `1B`; a successful sacrifice → `FO`; dud/DP/TP → `GB`) and
the real family is the nullable `buntResult` (null for a normal swing). The
`swingType` declaration is public (announced with the swing), so it also travels on
the batting `duelCommitments` row; the "bunt bonus" (a bunting pitcher's contact
raised to 4) is a boundary input adjustment in `atBat.ts`, never engine logic
(roster-free, ADR-0009).

`baseState` is **runner-aware** (SAN-44, ADR-0018): each base references the
player standing on it (`Id<'players'>`) or null, mirroring the engine's
`BaseState` (`RunnerId | null` per base) and following the
`currentBatter`/`currentPitcher` player-reference pattern, so an on-base runner's
already-modeled speed is reachable by id. A runtime mirror test anchors the
validator's base field set to the engine `BaseState` — the twin of the boundary
cast in `game.ts`/`atBat.ts`.

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

## Dev fixture seed (`convex/seed.ts` + `seedRoster.ts`)

`startGame` needs a `scheduled` game with two owned teams and two complete
lineups behind it, and nothing in the app creates one yet — the draft, salary
cap, and MLB ingest that eventually will are their own projects. `seedDevGame`
(SAN-54) mints that game so local development and manual QA have something to
play. It is a placeholder fixture, not the real roster-building flow.

**Double-fenced.** It is an `internalMutation`, so it never appears on the
generated public `api` and no browser client can name it in any deployment; and
it refuses to run unless `SANDLOT_DEV_SEED` is exactly `"true"` on the
deployment. The gate is **fail-closed** — an unset variable blocks it, so a
fresh deployment is safe before anyone thinks about it. `seed.test.ts` asserts
both halves: the throw, and a compile-time guard that fails `pnpm typecheck` if
the mutation is ever downgraded to a public one.

**Additive, not idempotent.** One synthetic owner (a fixed `clerkSubject` that
cannot collide with a real Clerk account), two clubs keyed on fixed names, and
their twenty players are created on the first run and reused verbatim forever
after; every run appends a *new* scheduled game plus its two lineups. Nothing is
deleted or patched, so earlier games stay playable history.

A player carries no team column — the only link from a team to its players is a
`lineups` row — so "does this club already have players?" is answered by reading
the club's **earliest lineup** and reusing its slots. That is what keeps the
roster stable across runs without a name-matching upsert.

Both clubs share the one owner, so a single mocked identity can act for both
sides of a duel.

**Known constraint — the seed cannot follow a club that moves.** It identifies a
club by owner + name, and the product may legitimately change both: a club can be
renamed, or re-pointed at a real signed-in user. There is no marker on the row to
follow it by, and adding one would put a throwaway fixture's bookkeeping
permanently into a production entity — so instead the seed re-checks its
assumption on every run and **refuses** when a club has moved, naming the clubs it
actually found. It never mints a replacement, because a replacement would carry no
prior lineup and would silently fork ten more players off the roster. Handing a
seeded club to a real user, and whatever should happen to the fixture afterwards,
belongs to the claiming ticket (SAN-62) — provisioning mints the user and claims
nothing.

`seedRoster.ts` is data only — two invented clubs, nine distinctly-positioned
batters and one arm each (**no MLB names or statistics**, ADR-0006). Every
hitter attribute spans at least three distinct 1–5 ratings across the nine
slots, and the two arms differ, so the `power − velocity` / `speed − awareness`
/ `eye − command` / `contact − movement` differentials actually vary instead of
resolving every at-bat off the same band. The seed writes no rollup rows —
`standings`, `playerStatLine`, and `boxScoreLine` are maintained by their own
tickets and must tolerate a game existing before any rollup row does.

```bash
npx convex env set SANDLOT_DEV_SEED true   # dev deployment only
npx convex run seed:seedDevGame            # → the new game's id
```

## Duel adapter (`src/design/duel/adapter.ts` + `roster.ts`)

The pure, headless boundary (SAN-45) that bridges the roster-free engine to the
UI's data shapes — no React, no I/O, the same resolve → apply → reveal logic the
future Convex client reuses. The engine resolves a single at-bat and advances
game state but is roster-free and produces neither a hit count nor display text;
the adapter fills exactly that gap:

- **`roster.ts` — synthetic fixtures (committed, no MLB data).** A `Roster`
  (`ReadonlyMap<string, RosterPlayer>`) maps each id → a display name, a single
  role-appropriate attribute block (hitter **xor** pitcher, the same shape the
  Convex `players` table models), and a 1–5 base-running speed. `AWAY_LINEUP` /
  `HOME_LINEUP` compose into `GAME_CONTEXT`, which `startGame` accepts; the away
  leadoff and home pitcher carry the blocks the tests probe for deterministic
  hit/walk/out outcomes.
- **`assembleRunnerSpeeds(bases, roster)`** — derives the engine's `BaseSpeeds`
  from a `LiveGameState.bases` plus the roster, defaulting a pitcher-as-runner to
  speed 1 (SAN-16) by detecting the block — the pure twin of `atBat.ts`'s
  `runnerSpeedsFor`.
- **`resolveDuelAtBat(pitch, swing, state, roster, hitsBefore?)`** — reads the
  seated batter/pitcher from the live state, resolves through the authoritative
  engine, and returns both an `AppliedAtBat` (for `advance`) and a
  `RevealScenario` (for the reveal).
- **Perspective (scope, not law).** `RevealScenario` is a view-model: `you` /
  `them` / `opponent` / `scoreBefore` are relative to *the side the reveal is
  rendered for*. SAN-45 fixes that side to the **batter** (a single half-inning —
  the at-bat is the batter's moment), so `you` = the batting team. This is **not**
  permanent: when two-sided async multiplayer lands, the logged-in user owns a team
  across both halves and "you" becomes *their* side (the pitching team during the
  opponent's at-bat). The generalization is local to the adapter — add a `viewer`
  input and key the three perspective-bearing spots (`you`/`them`, `scoreBefore`,
  `opponent`) off it instead of off the batting side; the engine stays
  perspective-free and the `RevealScenario` shape is unchanged. Downstream UI must
  not assume `you === batter` on its own.
- **Hit count + scoreline (the engine provides neither).** `accumulateHits`
  credits the batting team on a hit; `deriveScoreline` composes the reveal's line
  from the resolved outcome and base movement (runs in + where the batter landed).
  `createDuelAdapter(roster, context)` threads the live state through `advance`
  and tracks the running hit count across at-bats.
- **`OUTCOME_KEY_BY_BAND` / `toOutcomeKey`** — maps engine `OutcomeBandKey` → UI
  `OutcomeKey`. The two enums are identical today (the ladder is sourced from the
  engine), so it is an explicit identity map, but a `Record` forces all ten keys
  at compile time and a mirror test asserts coverage, so an unmapped outcome fails
  loudly rather than silently mis-displaying.
- **`deriveSituation(state, hits, roster)` / `deriveMatchup(state, roster, context)`
  (SAN-47).** The commit screen's inputs, read from `LiveGameState` rather than
  fixtures. `deriveSituation` returns a `DuelSituation` — the non-secret subset that
  structurally excludes both duel numbers (secret-state law); since SAN-51 it also
  carries `runnersOn`, the live base occupancy (lead order, occupancy only — never
  runner identity), so the commit/waiting field draws the real diamond. `deriveMatchup` mirrors
  the live pitcher-vs-batter matchup for both seats (hotseat casts the batting side as
  "you"; `DuelCommit.orientSeat` flips it per seat) and maps engine attribute blocks
  to the UI's pip labels. Both live in the adapter because they are perspective-bearing
  (see above) — the UI never decides `you`.

## Hotseat half-inning (SAN-47)

Ticket 1's adapter and Ticket 2's props-driven components wired into a playable
single half-inning, hotseat (one person enters both seats), ending at the third out.
Surfaced as the **PLAY** tab of the `/design` showcase — no new route.

- **`seatAgent.ts` — the seat-agent seam.** `SeatAgent.requestNumber(request)` names
  *who* supplies a seat's committed number. `SeatCommitRequest` carries the `DuelSeat`
  and the non-secret `DuelSituation` only — an agent (human or bot) can never see
  the opposing seat's number through it (secret-state law holds at the seam, not just
  the UI). `SeatKind` (`Human` / `Bot`) and `SeatKinds` name each seat's fill; a bot
  slots into either seat by implementing the same method, and the loop is unchanged.
- **`duelLoop.ts` — `playHalfInning(adapter, roster, agents, gate)`.** The pure,
  headless loop that sequences each at-bat: pitcher commits → batter commits → resolve
  → present reveal → seat the next batter, until the third out flips the half. The pitch
  is a local here and is **never** passed to the batter agent, so the secret lives only
  in this loop and the adapter it resolves through. The `RevealGate` seam lets the caller
  present each reveal and await the advance; `HalfSummary` accrues the batting side's
  runs/hits for the end-of-half card.
- **`useDuelPlay(roster, context, seats)` — the React seam.** Bridges the loop's
  promise-based agents/gate to React state and builds each seat's agent from `seats`:
  a **human** seat's `requestNumber` parks a resolver and shows the commit screen; a
  **bot** seat is `createBotAgent`, which resolves its number with no screen. The
  `RevealGate` parks a resolver and shows the reveal for a human to advance — unless the
  half is bot-vs-bot, where it resolves at once so the inning runs to completion with no
  human input. A lock or an advance resolves the parked promise so the loop steps
  forward. The pitch never enters React state.
- **`DuelPlay` / `SeatControls` / `HalfSummaryCard`.** `DuelPlay` renders the loop's
  current `PlayView` through the existing `DuelCommit` / `RevealMotion` screens (driven
  from live state) plus the end-of-half `HalfSummaryCard`, above a `SeatControls` bar
  that sets each seat to human/bot independently. Changing a seat or restarting bumps an
  epoch that remounts a fresh half-inning. `RevealMotion` carries an optional advance
  affordance (`onAdvance` / `advanceLabel`) so the container can drive the sequence.

## Bot seat agent (SAN-48)

A non-human seat agent that makes the seat-agent seam concrete for automated play,
enabling human-vs-bot and bot-vs-bot on the mock half-inning.

- **`botAgent.ts` — `createBotAgent(rng = Math.random)`.** Implements `SeatAgent` by
  drawing its seat's number **uniformly at random** over the valid duel range
  `[DUEL_MIN, DUEL_MAX]`. Uniform is the strategically-sound blind-duel baseline (the
  opponent's number is unknown, so expected outcome is pick-invariant — attributes size
  the bands, the number only sets the difference), not a placeholder; situational
  tendencies are a future enhancement. It ignores the request, so a bot seat carries no
  secret exactly as the seam guarantees. `rng` is injectable for deterministic tests.
  This is the seed of a future bot-vs-bot balance simulator (ADR-0010/0015).

## Live field state on the commit/waiting screens (SAN-51)

The number-entry (commit) and waiting screens' field shows the current game state —
the same diamond the reveal animates — instead of a decorative runner.

- **`FieldDiagram.runnersOn`** — optional occupancy: one token per occupied spot
  (the batter at the plate plus each occupied base, composed by
  `scenario.liveFieldSpots`). With it the field is exposed as `role="img"` whose
  label reads the base state ("Runner on 2nd", "Bases loaded" — `describeBases`);
  without it the diagram stays a bare, decorative (`aria-hidden`) diamond the
  reveal overlays with its own animated tokens.
- **One geometry, one skin.** Tokens are positioned by `fieldMovement.spotPoint`
  (percent of `FIELD_VIEWBOX`, so any box size tracks) and colored by
  `FieldDiagram.runnerTokenClass` (batter = hero, on-base runner = clay).

> **Superseded in part.** The reveal no longer shares this diagram — see *Two
> fields, on purpose* below. `FieldDiagram` remains the commit/waiting field; the
> interchangeability the two screens once had with the reveal was retired
> deliberately, not lost.

## Two fields, on purpose

The reveal stages its hit animation on **`Ballpark`**, not `FieldDiagram`. A bare
diamond is the wrong stage for a batted ball — it ends at the basepaths, which is
why the old reveal had to place a home run and a triple a bat's length apart above
second base. A whole park is equally wrong as a readout of who is on base.

- **`Ballpark`** — the reveal's stage: foul lines, infield dirt, warning track and
  fence, drawn in a wider `PARK_VIEWBOX` that extends past the bases. Fence, track
  and dirt are the same cubic nested at three depths, so the park reads as one
  shape. Bags come from `fieldMovement.spotPoint`, so both fields still share one
  source of geometry. Decorative throughout (`aria-hidden`) — the reveal states its
  outcome in the headline and scoreline.
- **`Ballpark.LANDING_ZONES` / `HIT_SPRAY`** — where each hit finishes, plus the
  deterministic spray either side of it. These live with the park because a landing
  zone only means something relative to the dirt it clears and the fence it does or
  doesn't; `Ballpark.test.tsx` asserts each zone holds its region across the whole
  spray box.
- **Runners live inside the SVG.** `RevealMotion` draws its tokens as `motion.circle`
  in park coordinates (glowing via `--drop-runner` / `--drop-runner-clay`, since
  `drop-shadow()` takes no spread length). One coordinate space for chrome, ball and
  runners means the camera moves the viewBox and the contents follow.

## The reveal's camera, flight and tempo (ADR-0022)

Three pure modules carry the reveal's behaviour, so the choreography is unit-testable
and `RevealMotion` stays a renderer.

- **`revealCamera`** — `cameraFrameAt(t, { zone, ballAt })` returns the viewBox at a
  moment. Tight on the diamond until contact, opening across exactly the flight so it is
  widest as the ball lands, then held. `FULL_OPEN_REACH` is *derived* from the deepest
  landing zone, so the longest ball opens the whole park and moving a zone can never
  leave the widest frame unreachable. Nothing in play means no widening at all — which
  matters, because 62% of at-bats never reach the outfield (SAN-15 balance harness).
- **`ballFlight`** — `ballPointAt` / `ballRadiusAt` / `ballTrailPath` over a
  `LandingZone`. A plan view has no vertical axis, so altitude is the ball's *radius*;
  the path bows sideways rather than arcing, and `lift: 0` keeps a grounder on the deck.
- **`revealTiming`** — `revealBeats(scenario, tempo)` computes the whole sequence in
  story seconds and multiplies once at the boundary. `REVEAL_TEMPO` (1.5) is the only
  pace knob; every duration in `RevealMotion` passes through the same `slow()` helper so
  no beat can keep its old duration and desynchronise.
- **`Ballpark.LANDING_ZONES`** is keyed by `BattedOutcome` (`OutcomeKey` minus `BB`/`K`),
  so a new outcome cannot be added without deciding where it lands.

---

_Components, hooks, and game-logic abstractions are added here as they land._
