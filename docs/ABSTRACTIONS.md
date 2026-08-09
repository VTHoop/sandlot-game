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
resolves its caller by looking the Clerk subject (`subject` on the `UserIdentity`
from `ctx.auth.getUserIdentity()`) up in `users.by_clerk_subject`
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
grants no team ownership — a provisioned user is a spectator until a club is
theirs, by the dev-only assignment (SAN-62) or by self-serve claiming (SAN-63,
both below).

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

## Live game read model (`convex/gameView.ts`)

`getGame({ game })` — the query a client subscribes to for the situation around
the duel (SAN-56), and the read half of the Convex-backed adapter. It is a
separate module from `game.ts` on purpose: that file's contract is
*authoritative writer, no client read path*, and this is the opposite — the
surface a batter's client watches while the pitch is already in the vault, so
what crosses the wire is reviewable in one place.

**A discriminated union on status**, not one shape with nullable seats, so a
screen cannot read a batter off a finished game or bases off a scheduled one:

| `status` | carries |
|---|---|
| `scheduled` | the matchup — both clubs, and which one the caller owns |
| `live` | inning · half · outs · runner-aware bases · both scores · both hit totals · the seated batter and pitcher · the caller's seat · the two lock booleans |
| `final` | both scores · both hit totals · the winning club |

- **Perspective is the client's.** Every number is absolute (`home`/`away`);
  the payload also names which club the caller owns (`viewer`) and, while live,
  whether that club is batting or pitching (`viewerSeat`). Both participants
  receive the identical situation and each flips it — this is the `viewer` input
  the duel adapter's module header was waiting for. A caller who owns *both*
  clubs (the dev seed's hotseat) reads as the home side.
- **Seats and runners resolve to renderable data** — `{ id, name }` for anyone on
  the field, plus the attribute block on the batter and pitcher. Runner identity
  is in the model whether or not a screen names one today.
- **No committed number is reachable from here, structurally.** The module never
  queries `duelCommitments`; it calls `atBat.duelLocks` and gets two booleans.
  The locks reset on their own — they are read at the current at-bat ordinal, and
  resolution advances it. A resolved at-bat's numbers stay `getActiveDuel`'s to
  reveal.
- **Not an existence oracle** — a non-participant, a caller with no identity (or
  no `users` row), and an id that resolves to nothing all return `null`
  identically. The participant-only gate is the safe default, not a law: roadmap
  result sharing will want a stranger to read a `final` game, and relaxing it
  there is that work's deliberate call.
- **Hit totals are derived, not stored.** Nothing on the `games` row tracks them,
  so they are folded out of the `atBats` log — `isHitBand` (engine) over each
  entry, credited to the club batting that half. The maintained `boxScoreLine`
  rollup is where they belong if the per-read fold ever stops being cheap.
- **It refuses rather than guesses.** A live row with an empty seat, or a base
  holding a player that no longer exists, throws — corrupt authoritative state,
  and an empty base would show the batter a situation that is not the real one.

## Dev fixture seed (`convex/seed.ts` + `seedRoster.ts`)

`startGame` needs a `scheduled` game with two owned teams and two complete
lineups behind it, and nothing in the app creates one yet — the draft, salary
cap, and MLB ingest that eventually will are their own projects. The seed
(SAN-54) mints that game so local development and manual QA have something to
play. It is a placeholder fixture, not the real roster-building flow.

**Three mutations, because the work has three lifecycles** (SAN-61, SAN-62).
`bootstrapDevLeague` stands the league up — the owner, both clubs, their twenty
players, and a scheduled game — and is run once on a fresh deployment.
`mintDevGame({ homeTeam, awayTeam })` appends another scheduled game between two
already-bootstrapped clubs, and is run whenever you want a fresh one.
`assignClubToUser({ team, clerkSubject })` hands one club to a real signed-in
account, and is run once per club a human should hold.

**Double-fenced.** Each is an `internalMutation`, so none appears on the
generated public `api` and no browser client can name them in any deployment;
and none runs unless `SANDLOT_DEV_SEED` is exactly `"true"` on the
deployment. The gate is **fail-closed** — an unset variable blocks it, so a
fresh deployment is safe before anyone thinks about it. `seed.test.ts` asserts
both halves: the throw, and a compile-time guard that fails `pnpm typecheck` if
any of them is ever downgraded to a public one.

**Additive, not idempotent.** Bootstrap creates one synthetic owner (a fixed
`clerkSubject` that cannot collide with a real Clerk account), two clubs keyed on
fixed names, and their twenty players on its first run, then reuses all of them
verbatim forever after. `mintDevGame` creates none of that — it reuses whatever
roster the clubs it was handed already field. Every run of either appends a *new*
scheduled game plus its two lineups. Nothing is deleted or patched, so earlier
games stay playable history.

A player carries no team column — the only link from a team to its players is a
`lineups` row — so "does this club already have players?" is answered by reading
the club's **earliest lineup** and reusing its slots. That is what keeps the
roster stable across runs without a name-matching upsert.

That link is also **why bootstrap cannot stop short of the first game**:
`lineups.game` is required, so a roster has nowhere to live until a game exists.
Splitting player creation into a game-less "league" step would leave orphaned
`players` rows and the next mint would find no prior lineup and insert a second
set. Standing rosters belong to the draft/salary-cap project; a dev fixture does
not get to reshape the schema for its own tidiness. `mintDevGame` therefore
**refuses** a club with no roster rather than inventing one — same fork, same
refusal as below. It likewise refuses two identical ids: both checks catch the
same caller mistake (the wrong id), and are questions about the arguments rather
than about ownership.

Both clubs share the one owner, so a single mocked identity can act for both
sides of a duel.

**Known constraint — bootstrap cannot follow a club that moves.** It identifies a
club by owner + name, and the product may legitimately change both: a club can be
renamed, or re-pointed at a real signed-in user. There is no marker on the row to
follow it by, and adding one would put a throwaway fixture's bookkeeping
permanently into a production entity — so instead bootstrap re-checks its
assumption on every run and **refuses** when a club has moved, naming the clubs it
actually found. It never mints a replacement, because a replacement would carry no
prior lineup and would silently fork ten more players off the roster.

**`mintDevGame` is the answer to that constraint**, not an exception to it. It is
handed two ids and never looks up, infers, or asserts anything about who owns
them, so it behaves identically before and after a real user claims a seeded club.
Once a club is claimed, re-running *bootstrap* refuses — permanently,
by design — and minting is the supported path. Provisioning (SAN-55) mints the
user and claims nothing.

**`assignClubToUser` is what performs a claim** (SAN-62). Provisioning gives a
signed-in human a `users` row; it does not make them a *participant*, because
every gate in `atBat.ts` / `game.ts` runs through `ownsTeam`. This re-points one
club's `owner` at the user behind a Clerk subject, and that single write is the
whole difference between "signed in" and "can commit a pitch".

It **refuses a subject with no `users` row** rather than provisioning one, which
keeps `upsertUserBySubject` the single writer of that table — `by_clerk_subject`
has no unique constraint, so the `.unique()` read every gate depends on is safe
only while one function does the inserting.

**Sequencing caveat:** that row is minted by `users.provision`, which the client
calls at sign-in — wiring SAN-38 owns and which is not in place yet. Until it
lands there is no way to mint one, since `provision` reads `ctx.auth` and
`npx convex run` carries no identity. So the assignment below is usable against a
real account only once SAN-38 has shipped; the seed owner's two clubs are what
make the fixture playable before then.

Two things it deliberately does not check, both of which self-serve claiming
(`convex/clubs.ts`, below) does:

- **Who currently holds the club.** Taking one back from a real user is a normal
  dev move — resetting the fixture, or handing it to a second test account.
- **How many clubs the user ends up with.** One club per user is the durable
  product rule (the league is one club per family member) and it is enforced on
  the path a real user can drive. This tool exists precisely so that rule never
  has to bend for local development: a solo developer holding both clubs can play
  both sides of a duel with two mocked identities.

Re-running it with the club's current holder is a **no-op that succeeds**, so the
command is safe to repeat.

`seedRoster.ts` is data only — two invented clubs, nine distinctly-positioned
batters and one arm each (**no MLB names or statistics**, ADR-0006). Every
hitter attribute spans at least three distinct 1–5 ratings across the nine
slots, and the two arms differ, so the `power − velocity` / `speed − awareness`
/ `eye − command` / `contact − movement` differentials actually vary instead of
resolving every at-bat off the same band. The seed writes no rollup rows —
`standings`, `playerStatLine`, and `boxScoreLine` are maintained by their own
tickets and must tolerate a game existing before any rollup row does.

```bash
npx convex env set SANDLOT_DEV_SEED true        # dev deployment only
npx convex run seed:bootstrapDevLeague         # once → the new game's id
npx convex run seed:mintDevGame '{"homeTeam":"…","awayTeam":"…"}'   # another game
# once per club a human should hold; needs users.provision to have run for that
# subject first (SAN-38 wires it into sign-in):
npx convex run seed:assignClubToUser '{"team":"…","clerkSubject":"user_…"}'
```

## Self-serve club claiming (`convex/clubs.ts`)

The browser-reachable half of becoming a participant (SAN-63, ADR-0024). The
assignment above is enough for one developer with a CLI; this is the path five
family members can drive themselves. No schema change — one query and one
mutation over the existing `teams.owner` / `by_owner`.

**A club is claimable exactly when the seed owner holds it.** That predicate is
deliberately neither a `claimable` column (fixture-era bookkeeping, permanently
in a production entity, owing a migration for a mechanism expected to be deleted)
nor a check on the Clerk subject's *shape* (which would promote `seed.ts`'s
defensive aside into a load-bearing external contract, and one that fails **open**
— a change to Clerk's subject formatting would silently put real users' clubs on
offer). It does mean a public surface depends on a dev fixture's constant, and it
fails **safe**: no seed-owner row, nothing claimable.

**`availability` answers the caller's status, not a list.** Four cases, because
they are four screens: `unauthenticated` (no identity *or* no `users` row — the
same thing to every gate), `available` (the clubs on offer), `holding` (the club
they already have), `none_left` (signed in, holding nothing, nothing left). An
empty array plus a guess renders the wrong screen for one of the last two.
Unauthenticated is an answer rather than a throw, matching every other
participant-gated read: until SAN-38 wires `provision` into sign-in, a valid
signed-in caller has no row, and the screen still has to render.

**Each club is `{ id, name }` and nothing else.** The read reaches a signed-in
*non-participant*, so a roster or live game state here would be a game-integrity
leak. `owner` is withheld too — it answers "who else is playing" for someone who
has not joined, and no picker needs it.

**`claim({ team })` names the club and nothing else**, so the recipient is always
`ctx.auth` — a compile-time guard in `clubs.test.ts` fails `pnpm typecheck` if a
recipient argument is ever added, which is precisely what would turn this into
the dev assignment tool with its fences off. Three refusals, in the order a
caller meets them: not provisioned, already holding a club (**one club per user**
— the durable product rule, enforced here because this is the only path a real
user can drive), and reaching for a club the seed owner no longer holds (**a real
user's club cannot be taken**). Re-claiming your own club is refused by the
one-club rule rather than passing as a no-op: the client sending it is working
from a stale view.

**Race-proof by structure, not by check order.** `claim` reads the club row it
then patches, so two callers reaching for one club overlap read and write sets —
Convex's serializable OCC conflicts the loser, whose retry re-reads a club the
seed owner no longer holds and refuses. One caller reaching for two clubs at once
is the same argument on the other index: both attempts read the caller's
`by_owner` range, and the patch writes into it. Same discipline as the duel's
ordinal (SAN-20) and the provisioning upsert (SAN-55).

The bot's team (SAN-58) survives claiming for free: taking one club leaves the
seed owner holding the other, and only what the seed owner holds is on offer.
Where the claim is *offered* — screen, routing — belongs to the app shell
(SAN-38), not here; nothing calls either function yet.

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
