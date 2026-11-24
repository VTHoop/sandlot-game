# 42. `teams.owner` is optional; a real MLB team gets an ownerless `teams` row on its first pick

- Status: Accepted
- Date: 2026-11-24
- Settles: the open question in ADR-0039 § Consequences ("whether `teams.owner` stays required … is left to SAN-34 and SAN-78")

## Context

A `games` row references two `teams` rows, and `lineups`, `standings` and `boxScoreLine` reference `teams` too. A real MLB team picked for a pickup game (ADR-0041) has no meaningful owner, and since ADR-0039 nothing about who plays depends on one.

## Decision

- **Pickup teams are `teams` rows.** Everything that already points at a team keeps working unchanged.
- **`teams.owner` becomes optional.** A real team has none. Owned teams (the dev seed's) keep theirs; the `by_owner` index stays.
- **The row is created on the first pick and reused after.** `pickup.createPickupGame` looks for the ownerless row of that name through the new `teams.by_name` index and inserts it if absent. Reading that index range before inserting into it is the concurrency guard: two simultaneous first picks conflict and the loser retries onto the winner's row (the same OCC argument as the provisioning upsert, SAN-55). No uniqueness column or lock.
- **Only a team with no owner counts as the real team of that name.** A seeded club that happens to share a name is never reused.
- **The backfill refuses an ownerless team.** `seed.backfillGameManagers` throws on one rather than invent a manager: every game naming one was created with managers.

## Alternatives considered

- **No `teams` row; store the MLB team name on the game.** Every table that references `teams` would need a second shape.
- **Keep `owner` required with a placeholder owner.** A fake account that owns every real team is a lie the schema would have to remember.

## Consequences

- **+** No migration: widening a field validator invalidates no stored row.
- **−** Any reader of `teams.owner` must handle `undefined`; today only the backfill and test fixtures read it.
- Whether ownership is per league is still SAN-34's.
