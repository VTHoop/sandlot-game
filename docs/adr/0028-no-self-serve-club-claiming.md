# 28. No self-serve club claiming: seed clubs are test fixtures, handed out only from the CLI

- Status: Accepted
- Date: 2026-09-26
- Supersedes: ADR-0024 (self-serve club claiming)

## Context

ADR-0024 (SAN-63) added `clubs.availability` and `clubs.claim` to
`convex/clubs.ts`: a public query and a public mutation a signed-in user could
drive from a browser to take a club. A club was claimable exactly when the dev
seed owner (`SEED_CLERK_SUBJECT`) held it.

That predicate treats test fixtures as real clubs. The seed's two clubs exist
so there is a game to play in development. They are not the league's clubs.
Two things have made the mismatch worse since then:

- SAN-58 (ADR-0027) made seed-held clubs the bot's teams. A claim could take the
  bot's club, including in the middle of a game.
- A browser-reachable module imported a constant from the dev seed. Before
  this change, `clubs.ts` was the only public module that did.

Nothing called either function yet, because SAN-38 had not built a screen for
them. Changing course cost nothing now and would cost more once a screen
depended on them.

## Decision

**There is no self-serve claiming in the app.** `convex/clubs.ts` and its tests
are deleted. No public function hands out seed clubs.

**Until the draft/salary-cap work lands, a real user gets a club only through
`seed.assignClubToUser`.** It is an `internalMutation` behind
`SANDLOT_DEV_SEED`, run from the CLI. It is unchanged, and it is the documented
way to give a family member a club.

**The one-club-per-user rule goes away with `clubs.claim`.** It is not added to
`assignClubToUser`, which stays exempt so one developer can hold both clubs and
play both sides. Revisit the rule when the draft lands, since the draft is what
really hands clubs to people.

**The bot's definition does not change.** A seat is the bot's exactly when the
seed owner holds its club (ADR-0027). The bot may still read the seed owner's
identity on the commit path, since that is how it tells a bot seat from a human
one. Test games are either human vs. human or human vs. bot, never both at
once, so the seed's two clubs are enough. Running `assignClubToUser` with
`SEED_CLERK_SUBJECT` hands a club back to the bot.

## Alternatives considered

**Keep `clubs.claim` and exclude the bot's clubs.** Rejected. Every club the
seed mints is a fixture, so the problem is the claimable predicate itself, not
one edge case of it. A "claim" screen that hands out fixtures would still teach
family members that test data is their team.

**Keep the functions and leave them unused until the draft.** Rejected. An
unused public mutation that moves club ownership is attack surface with no
benefit. It also invites a screen to be built on it (SAN-38 or its successor).

## Consequences

- `SEED_CLERK_SUBJECT` is now read only by the seed and the bot. Both are gated on
  `SANDLOT_DEV_SEED`.
- SAN-38 builds no claim screen. A signed-in user whose account has not had a
  club assigned is a spectator until someone runs the CLI command.
- A family member who needs a club, or a different club, needs the developer.
  That is acceptable at family scale and until the draft replaces this.
