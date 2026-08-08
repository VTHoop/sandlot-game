# 24. Self-serve club claiming: seed ownership is the claimable predicate, one club per user

- Status: Accepted
- Date: 2026-08-08

## Context

Provisioning (SAN-55, ADR-0023) mints a `users` row and grants nothing: every
gate in `convex/atBat.ts` / `convex/game.ts` runs through `ownsTeam`, so a
signed-in human is a spectator until some club's `owner` points at them.
`seed.assignClubToUser` (SAN-62) performs that move, but it is an
`internalMutation` behind `SANDLOT_DEV_SEED` — reachable from a CLI, never from a
browser. That is enough for one developer. It is not enough for a family of six
who sign up and expect to end up with a team (SAN-63).

Three things had to be decided:

**1. What makes a club claimable.** Nothing on a `teams` row says "unheld". The
league's clubs are minted by a dev fixture whose owner is a synthetic account,
and the only signal in the data is who currently holds them.

**2. Whether one user may hold more than one club.** The dev-only path allows it
deliberately — a solo developer holding both clubs can play both sides of a duel.
A real user doing the same takes a club away from a family member.

**3. What the discovery read returns.** A claim screen has more than one empty
state, and a list alone cannot distinguish them.

## Decision

**A public query + a public mutation in `convex/clubs.ts`**, no schema change:
`clubs.availability` and `clubs.claim({ team })`.

**A club is claimable exactly when the seed owner (`SEED_CLERK_SUBJECT`,
`convex/seed.ts`) holds it.** A browser-reachable surface therefore depends on a
dev fixture's constant, knowingly. It fails *safe*: on a deployment where the
seed never ran there is no seed-owner row, so nothing is claimable and the read
answers `none_left` rather than offering a real user's club.

**One club per user, enforced here.** Six family members, six clubs, one each is
a durable product rule, and this is the only path a real user can drive — so this
is where it lives. SAN-62's dev-only assignment stays exempt on purpose, so the
rule never has to bend for local development. Re-claiming a club you already hold
is refused by that same rule rather than passing as a no-op: the client sending
it is working from a stale view, and a silent success would confirm a picture of
the league that may no longer be true.

**The read answers the caller's status, not a list.** `ClaimStatus` is a
four-way discriminated union — `unauthenticated` / `available` / `holding` /
`none_left` — because "no clubs left to take" and "you already hold a club" are
different screens, and an empty array plus a guess renders the wrong one for one
of them. `unauthenticated` is an answer rather than a throw, matching every other
participant-gated query: until SAN-38 wires `users.provision` into sign-in, a
valid signed-in caller has no row, and the claim screen has to render something
during exactly that window.

**Each club is exposed as `{ id, name }` and nothing more.** This read reaches a
signed-in non-participant, so a roster or live game state arriving here would be
a game-integrity leak. Even `owner` is withheld — it answers "who else is
playing" for someone who has not joined, and no picker needs it.

**Both refusals are race-proof by structure, not by check order.** `claim` reads
the club row it then patches, so two callers reaching for one club overlap read
and write sets and Convex's serializable OCC conflicts the loser — whose retry
re-reads a club the seed owner no longer holds, and refuses. One caller reaching
for two clubs at once is the same argument on the other index: both attempts read
the caller's `by_owner` range, and a patch writes into it. Same discipline as the
duel's ordinal (SAN-20) and the provisioning upsert (SAN-55).

## Alternatives considered

**A `claimable` column on `teams`.** Rejected: it puts fixture-era bookkeeping
permanently into a production entity, and owes a migration for a mechanism that
is expected to be deleted — the real path to owning a club is the draft and
salary cap, which supersedes claiming entirely.

**Inferring claimability from the Clerk subject's shape.** `seed.ts` notes that
its `seed|…` prefix is not a shape Clerk issues; treating that as the test would
promote a defensive aside into a load-bearing external contract, and one that
fails *open* — a change to Clerk's subject formatting would silently make real
users' clubs claimable.

**Reusing `seed.assignClubToUser` with the fences removed.** Rejected on both
fences at once: it takes the recipient as an argument (so any caller could hand a
club to anyone) and it makes neither refusal this path exists to make. The
overlap is a single `ctx.db.patch`; sharing it would couple a public surface to a
fixture's lifecycle for no reuse worth having.

## Consequences

- `convex/clubs.ts` imports a constant from `convex/seed.ts`, so deleting the
  fixture is no longer a purely dev-side change. Both are expected to be removed
  together when roster-building lands; until then, the import is the honest
  record of where the league's clubs come from.
- Nothing calls either function yet. The screen and routing belong to SAN-38 or
  its successor; this ticket ships the surface and its tests.
- The bot's team (SAN-58) survives claiming for free: taking one club leaves the
  seed owner holding the other, and only clubs the seed owner holds are on offer.
- A user who claims the wrong club cannot undo it themselves. That is acceptable
  while the dev-only assignment can re-point any club from the CLI, and it is the
  first thing to revisit if claiming outlives its expected lifespan.
