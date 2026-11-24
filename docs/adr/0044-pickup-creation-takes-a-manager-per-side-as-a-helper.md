# 44. Pickup creation takes a manager per side, as a helper that is not a public argument

- Status: Accepted
- Date: 2026-11-24
- Builds on: ADR-0039 (a game records a manager per side), ADR-0041 (`createPickupGame`)

## Context

`createPickupGame` makes the caller the manager of both sides, so two people cannot play each other and the bot cannot be an opponent. Games already record a manager per side; only the creation path assumed one person. The open challenge (SAN-80) and the bot opponent (SAN-81) both need to create a game with different managers.

## Decision

- **The creation core is `createGameBetween(ctx, { homeTeam, awayTeam, homeManager, awayManager })` in `convex/pickup.ts`.** Each manager is a user or the bot. `createPickupGame` stays public, signs the caller in, and passes them as both managers; its arguments and result do not change.
- **It does no sign-in and is not exposed to clients.** A client that could name any account as the other manager could put games in someone else's list without their consent. The consent is the other person's join (SAN-80); the bot needs none.
- **It is a plain function, not an `internalMutation`.** A caller runs it inside its own transaction, so a join that claims a challenge and creates the game commits or fails as one. An internal mutation reached through `runMutation` would be a second transaction.
- **It refuses, before the first write:** the same team on both sides, a user manager with no `users` row, a team with no lineup, and the bot managing both sides. One user on both sides (hotseat) is accepted. The bot on both sides is refused because no one could start that game (ADR-0027, ADR-0039).

## Consequences

- **+** SAN-80 and SAN-81 call one tested seam instead of copying the insert.
- **+** The secret-pitch contract is tested for a game with two different user managers.
- **−** Nothing in the type system stops a future mutation from passing a client-supplied account as a manager; the rule above is the guard, and review of each caller is what enforces it.
