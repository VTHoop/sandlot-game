# 26. Categorised commit rejections, a leaf wire contract, and the duel gateway port

- Status: Accepted
- Date: 2026-09-14

## Context

SAN-57 gives the duel a second `DuelAdapter`: the same `playHalfInning` loop and
the same components, with the prototype's in-memory `LiveGameState` swapped for
Convex round-trips. The loop must drive either without branching on which it
holds.

Three questions had no answer in the codebase yet, and each has two defensible
answers that produce incompatible clients.

**1. How a refused commit tells the client what it was.** `convex/atBat.ts` has
five rejection sites — not live, not your club, empty seat, number outside the
ring, already locked at this ordinal. All five threw a bare `Error` whose only
distinguishing feature was its message. A client that needs to know whether the
seat may commit again has nothing to read but that string.

**2. What a browser may import to learn the answer.** The vocabulary lives in the
vault module, which imports `_generated/server`, the authoritative resolver, and
the participant gates. A client importing an enum from there pulls all of it into
the bundle.

**3. How the adapter reaches Convex.** A `ConvexReactClient` dependency would put
React in the adapter's import graph, and `convex-test` could not drive it.

Underneath all three sits the requirement that actually shapes the module: the
loop reads `adapter.state()` twice immediately after `playAtBat` returns
(`duelLoop.ts`), so an adapter that settles before its cached snapshot reflects
the at-bat it just resolved re-seats the same batter and commits the at-bat
twice.

## Decision

**A rejection carries its category as data, not as prose.** Each refusal throws a
`ConvexError` whose `data` is `{ rejection, reason }`. `DuelRejection` splits on
**what the seat should do next** — the only distinction a caller can act on:
*terminal* (not live, not your club, empty seat) versus *re-enterable* (already
locked at this ordinal, number outside the ring). `reason` is display copy for a
log or a toast and is never the discriminant. Neither category is normal flow: the
commit screen shares `isDuelNumber` with the server, so a range rejection means
the screen was bypassed, and an empty seat means the live row is inconsistent.

**Authentication stays uncategorised.** The shared gate in `participants.ts`
refuses an unsigned caller before any duel rule applies, and signing in is not a
duel concern (SAN-38 owns that). Ownership *is* checked here rather than through
the shared `assertOwns`, so the duel's taxonomy stays the duel's and `game.ts` /
`clubs.ts` keep the shared helper and its message unchanged.

**The vocabulary lives in a leaf module, `convex/duelContract.ts`** — what a
commit hands back, why one was refused, and what the reveal query reports. It
imports no Convex server runtime, only `convex/values` and engine types, so a
browser client can branch on it without pulling the vault in. `atBat.ts` owns the
behaviour and re-exports the vocabulary, so `./atBat` stays a valid door.

**A commit's result names the ordinal it resolved.** `DuelCommitResult` gains
`sequence`, which is what lets `playAtBat` *confirm* rather than assume: after
committing, it re-reads and requires the duel view to report that same ordinal,
refusing otherwise. Without it, "the read reflects my at-bat" is an assumption
with no way to fail loudly — and its failure mode is a duplicate at-bat.

**The resolved reveal carries the ground-ball sub-result.** The band alone would
let a double play shout "GROUNDOUT" and retire runners in place instead of at the
bag they were forced to, making the server path poorer than the fixture path it
replaces.

**The adapter reaches Convex through a `DuelGateway` port** — one read of the
game, one of the duel, and one mutation per seat, with the game id already bound.
It keeps the module React-free and headlessly drivable, and it is the seam SAN-22
replaces with a subscription: a pushed snapshot installs through `refresh()`
exactly as a re-read does.

**`DuelAdapter.state()` returns `DuelState`, a subset of `LiveGameState`.** The
read model deliberately returns no batting-order pointers and no applied-sequence
marker (ADR-0025: renderable data, not the writer's bookkeeping), and no consumer
reads them. `createDuelAdapter` keeps a richer `InMemoryDuelAdapter`, so the
fixture path still hands its own callers the whole envelope.

## Alternatives considered

**Parsing the message on the client.** Rejected: it couples the client to server
copy, so rewording an error silently changes behaviour, and nothing fails when it
does.

**A `rejection` field on a plain `Error`.** Rejected: only `ConvexError.data`
survives the wire. A plain throw reaches the client as a message, which is the
thing the category exists to stop callers parsing.

**Categorising inside `participants.ts`.** Rejected: `assertOwns` is shared with
`game.ts` and `clubs.ts`, which have their own rejection stories. A duel-shaped
category on a shared helper makes every caller inherit a vocabulary that does not
describe them.

**Polling until the snapshot advances.** Rejected in favour of a single read plus
an ordinal check. A poll needs a clock in the tests and turns a stale read into a
hang; refusing turns it into a stack trace. When SAN-22's subscription can lag,
waiting becomes the right behaviour — and it will be added against a check that
already names what it is waiting for.

**Inventing batting-order pointers on the Convex adapter** so `state()` could
return a full `LiveGameState`. Rejected: two fabricated numbers in fields named
for real ones, which the next reader has no way to know are fiction.

**Fetching due-up on the client from the lineups.** Rejected: it would mean
exposing the batting-order pointer the read model deliberately keeps, to
re-derive a list the server can resolve to names in the same query.

## Consequences

- The duel's five refusals are now branchable. The loop still holds no retry
  logic — recovering from a re-enterable rejection is the commit screen's job,
  and that screen is SAN-22's.
- Anything that is *not* a categorised rejection propagates untouched. The Convex
  client retries a dropped mutation itself, so only application errors thrown
  inside one are final; labelling a transport fault as a game rule would be worse
  than not labelling it.
- `duelContract.ts` is the pattern for any future client-facing Convex
  vocabulary: the module that owns the behaviour keeps it, and the words the
  browser needs move to a leaf.
- Importing a Convex type into `src` compiles those modules under the app's
  tsconfig, which targets ES2020 while Convex targets ESNext. `Array.at` in
  `gameView.ts` was the first casualty. The app's target is the older of the two
  and the engine already builds at ES2022; raising it is a separate decision, not
  a side effect of this one.
- Perspective stays batter-fixed. ADR-0025 anticipated SAN-57 keying `you` off
  `viewer`; hotseat owns both clubs, so there is no second viewpoint to serve yet
  and the generalisation belongs to SAN-39, the first screen with a real viewer.
