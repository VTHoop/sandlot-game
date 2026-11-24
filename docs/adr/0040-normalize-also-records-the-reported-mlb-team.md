# 40. A normalize re-run also records the player's reported MLB team

- Status: Accepted
- Date: 2026-11-24
- Supersedes (in part): ADR-0038 Decision 1, the clause "A re-run patches `name`, `position` and `attributes` and nothing else"

## Context

SAN-77 lets a player pick a real MLB team, and a team is offered only when its `source: 'mlb'` players can field a lineup. That needs each player's team on the `players` row. The raw `mlbSeasonStats` row already carries it (`team`, ADR-0037), and `normalize.run` is the only writer of `source: 'mlb'` players. ADR-0038 limited what a re-run may touch to the three fields it derived, so a price survives.

## Decision

- **`players` gains an optional `mlbTeam`.** `normalize.run` writes it on insert and patches it on a re-run, alongside `name`, `position` and `attributes`. The set a re-run touches is now those four; a price still survives, and players the season no longer lists are still left alone.
- **The value is the raw row's reported team.** For a player with more than one team in the season (`numTeams` > 1) the API reports his latest, so that is what is recorded. Nothing is guessed or derived.
- **Optional, never defaulted.** Custom players and `mlbTeam`-less rows from before SAN-77 have none; a player with no team counts toward no team (`eligibleMlbTeams`, `convex/mlbTeams.ts`). Rows gain the field when `pnpm normalize:mlb` is next run for the season.

## Alternatives considered
- **Join to `mlbSeasonStats` at read time.** Keeps `players` unchanged, but every team read would scan raw rows keyed by season, and a player would have no single current team across seasons.
- **A separate `mlbTeams` table.** More structure than a name needs; no second attribute of a team exists yet.

## Consequences
- **+** The team list is one indexed read of `players`, computed in TypeScript.
- **−** Existing rows have no team until normalize is re-run; until then no team qualifies.
- **−** A mid-season trade moves the player's team on the next re-run, so a stored lineup naming him is not retroactively re-validated against his old team.
