# 25. The client game read model: status-discriminated, absolute perspective, derived hit totals

- Status: Accepted
- Date: 2026-08-09

## Context

Until now nothing returned a game to a client. `getActiveDuel` (SAN-20) reports
the current duel's lock state and, once both numbers land, the reveal — never the
situation around it. Everything else the duel screens show (inning, outs, bases,
the two seats, the score, the hit totals) came from a `LiveGameState` the
prototype held in React state (`src/design/duel/adapter.ts`). Over a network it
has to come from a query, and that query is the read half of the Convex-backed
adapter (SAN-56, blocking SAN-22 and SAN-57).

It is also the single riskiest surface in the project for the secrecy invariant
(AGENTS.md § Game integrity, ADR-0014): it is the query the *batter's* client
subscribes to while the pitcher's number is already sitting in `duelCommitments`.
Everything below is downstream of that.

Four questions had to be settled before an implementer could build it, because
each has two defensible answers that produce incompatible clients.

**1. One shape or several.** A game has three statuses. A scheduled game has no
seats and no bases; a final game has no seats either.

**2. Whose perspective the payload is in.** The prototype's view-models are
relative — `you`, `them`, `opponent`, `scoreBefore.you` — and fixed to the batter.
Two networked participants read the same row from opposite sides.

**3. Where hit totals come from.** `DuelSituation.hitsBefore` needs them; the
`games` row has no hits field and never did. The prototype accumulated them in
adapter memory (`rollHitTotals`).

**4. What a caller who may not read it is told.**

## Decision

**A dedicated module, `convex/gameView.ts`, exporting `getGame({ game })`** —
deliberately not added to `convex/game.ts`. That module's entire stated contract
is *authoritative writer, never a client read path* (ADR-0004 / ADR-0017); this
is the exact opposite, and keeping the outbound shape in its own file makes "what
crosses the wire" reviewable in one place. It is the seam the secrecy argument
rests on, so it gets a file.

**The return type is a discriminated union on `status`**, not one shape with
nullable seats. Reading a batter off a `final` game is a compile error rather
than a null check every screen has to remember forever. This is the same call
ADR-0022 made for the reveal stage: make divergence structural rather than a prop
nobody remembers to set.

**Perspective belongs to the client; the server answers absolutely.** Scores and
hit totals are returned per club (`home`/`away`), together with which club the
caller owns (`viewer`) and, while live, whether that club is batting or pitching
(`viewerSeat`). The situation itself is therefore identical for both
participants — only those two fields are resolved per caller — and each client
flips the shared half locally. This is precisely the `viewer` input the duel
adapter's module header anticipated. A caller who owns both clubs — the dev
seed's single-owner hotseat — reads as the home side.

**The query cannot reach a committed number, structurally.** `gameView.ts` never
queries `duelCommitments`. It calls `atBat.duelLocks`, which lives in the vault's
own module and returns two booleans. That a side has locked is the only
pre-resolution signal that may cross to an opponent (ADR-0014); the numbers of a
*resolved* at-bat remain `getActiveDuel`'s to reveal, so the two queries keep
distinct jobs rather than one growing into the other.

**Hit totals are derived from the `atBats` log, not stored.** Each entry already
records its outcome band and the half it was struck in, which names the club that
was batting. `isHitBand` moves to `@sandlot/engine/outcomes` so "which bands are a
hit" is a rule of the game living with the bands. Deriving per read is
always-correct at a six-inning game's log length; the maintained `boxScoreLine`
rollup (ADR-0004) is where the totals belong if that ever stops being true — not
a new field on the live row.

**Three refusals answer identically with `null`:** a non-participant, a caller
with no identity (or no `users` row — every gate treats those the same), and an id
that resolves to nothing. Matching `getActiveDuel`, and indistinguishable on
purpose: an error that separated them would make the query an oracle for which
games exist.

**Corrupt authoritative state throws rather than renders.** A live row with an
empty seat, or a base holding a player that no longer exists, is not a client
condition — and silently drawing an empty base would show the batter a situation
that is not the real one, in the moment they commit a number against it.

## Alternatives considered

**One flat shape with nullable `batter` / `pitcher` / `bases`.** Rejected: it
converts a fact the server knows into two null checks per screen, forever, and
nothing makes a missed one fail loudly.

**Returning `you` / `them` from the server.** Rejected: the same row would
serialize two ways, doubling the reactive query's cache key for no gain, and it
puts a rendering concern inside the vault-adjacent surface. Absolute values also
make the payload directly comparable in tests — the "both participants receive
the same payload" assertion is only expressible this way.

**A `homeHits` / `awayHits` pair on the `games` row.** Rejected: a second
authoritative counter to keep in step with the log, which is exactly the
divergence ADR-0004's append-only-log-plus-state shape exists to avoid. If reads
get expensive, the answer is the rollup that already exists.

**Adding `getGame` to `convex/game.ts`.** Rejected on the seam, not on size:
that module's value is that it is provably not a read path.

## Consequences

- SAN-57 can swap the in-memory adapter for server round-trips against a shape
  the prototype's `deriveSituation` / `deriveMatchup` already want, and SAN-22's
  subscriptions have something to subscribe to.
- The client now owns perspective. The duel adapter's "you = the batter" scope
  note becomes a real generalization task in SAN-57, keyed off `viewer`.
- Every `getGame` read scans the game's at-bat log. Acceptable at a six-inning
  family league; it is the first thing to measure if a live game ever feels slow,
  and the rollup is the fix.
- `isHitBand` now has a canonical home. The two UI copies of that set
  (`src/components/ui/OutcomeLadder.tsx`, `src/design/duel/scenario.ts`) predate
  it and should collapse onto it — out of scope here, but they are now
  duplicates of a rule with an owner.
- The participant-only gate is a safe default, not an invariant. Roadmap result
  sharing means a stranger reading a `final` game; relaxing it for that status is
  that work's deliberate call, and the code says so where it gates.
