# 23. Account provisioning: an explicit client-called mutation, write-once profile

- Status: Accepted
- Date: 2026-08-07

## Context

`convex/participants.ts` resolves the caller of every server function by looking
`ctx.auth.subject` up in `users.by_clerk_subject`, and `convex/atBat.ts` /
`convex/game.ts` gate every mutation behind the result. Nothing in the codebase
ever inserted a `users` row, so for a real signed-in Clerk user `authedUser`
threw `Not authenticated` unconditionally, forever — the whole vertical slice was
gated shut behind a row that could not come into existence (SAN-55).

Three things had to be decided, none of them derivable from the code:

**1. What creates the row.** Clerk owns the identity; Convex owns the account.
Something has to bridge them, and the choice determines whether account creation
is a visible, testable act or a side effect scattered across the API surface.

**2. Where `displayName` comes from, and whether it tracks Clerk.** The column is
non-optional and a Clerk identity can carry no name at all. Sourcing it is one
decision; whether later sign-ins overwrite it is a separate, louder one.

**3. Whether a first-time double-call can produce two rows.** `by_clerk_subject`
has no unique constraint, and it is read with `.unique()` — which *throws* on a
duplicate. A lost race would not degrade the account; it would permanently break
every subsequent lookup for that user. `src/main.tsx` renders under
`<StrictMode>`, which double-invokes effects in dev, so a sign-in effect calling
this is a realistic source of exactly that double-call.

## Decision

**Provisioning is an explicit `mutation` the client calls on sign-in**
(`api.users.provision`, `convex/users.ts`), returning the `users` row id.

It **cannot** be lazy work inside `maybeUser` / `authedUser`: those take a
`QueryCtx | MutationCtx` and Convex queries cannot write, so a first-time user
would still fail every read. And making it implicit would turn every gated
mutation into a hidden account-creation write path.

**The mutation takes no arguments.** The subject is read only from `ctx.auth`, so
a caller can provision itself and nothing else. `users.test.ts` carries a
compile-time guard that fails `pnpm typecheck` if an argument is ever added.

**`displayName` is derived once, by a stated fallback chain, and never
re-synced:** full name → username (`nickname`, which is what Clerk's `convex` JWT
template maps the username to) → email local-part → the constant `"Manager"`.
Blank and whitespace-only claims count as absent, and the result is never empty.
The row is write-once because `users.displayName` is the *app's* column, not a
mirror of Clerk's: Clerk answers "who are you", the row answers "what are you
called". A future in-app profile screen owns that field, and a re-sync on every
sign-in would silently revert whatever the user set there.

**One upsert, shared.** `upsertUserBySubject` is the single place a `users` row is
created. It reads the `by_clerk_subject` range it then inserts into, so two
concurrent first-time calls overlap read and write sets and Convex's serializable
OCC conflicts one — the retry finds the committed row and returns it. The dev
fixture (`convex/seed.ts`) is now just another caller of it, holding a subject
shape Clerk cannot issue, so neither side can reach the other's row.

**Provisioning grants nothing.** A provisioned user owns no team and is a
participant in no game. Turning a user into a participant is SAN-62's job.

## Alternatives considered

**A Clerk webhook syncing `user.created` / `user.updated` into Convex.** The
standard production shape, and the right answer once profile data actually
matters. Rejected for now: it needs a public HTTP endpoint, signature
verification, and a replay/ordering story, and it buys nothing this slice uses —
`displayName` is the only Clerk-derived field, and we have just decided it must
*not* track Clerk. It also fails open in the wrong direction: a dropped webhook
leaves a signed-in user with no account and no client-side recovery. Revisit if a
second Clerk-owned field appears, or when deletion has to propagate.

**Lazy provisioning inside `maybeUser`/`authedUser`.** Rejected on the mechanics
above — Convex queries cannot write, so it does not solve the read path it would
exist to solve.

**A unique index on `clerkSubject` instead of the OCC argument.** Convex does not
offer one. The read-then-insert-into-the-range-just-read discipline is the
project's existing answer to this shape (SAN-20's duel ordinal, the seed's three
reuse lookups) and is reused here rather than invented.

## Consequences

- Every signed-in user must reach `provision` before any gated function works.
  Wiring that call into the sign-in flow — and deciding what the app shows during
  the authenticated-but-not-yet-provisioned window — belongs to SAN-38. Until
  then, that window behaves exactly like being signed out: `maybeUser` returns
  null and participant-gated queries return null rather than throwing.
- `displayName` will drift from Clerk the moment a user edits their Clerk profile.
  That is intended, and it is the reason a profile screen is now owed.
- The fixture seed and real provisioning share a write path. If the seed's subject
  ever became one Clerk could issue, a real player would inherit the bot's clubs —
  `users.test.ts` asserts the isolation from both directions.
