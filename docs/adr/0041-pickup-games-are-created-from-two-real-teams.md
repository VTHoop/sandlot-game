# 41. A pickup game is created from two real MLB teams and carries an explicit marker

- Status: Accepted
- Date: 2026-11-24

## Context

Until SAN-78 a game could only be minted by the dev seed from the command line. Kids need to start a game themselves between two real MLB teams (SAN-77) with no team ownership involved. ADR-0039 made a game record its managers, so who plays no longer depends on who owns a team.

## Decision

- **`pickup.createPickupGame({ homeTeam, awayTeam })` is the creation path.** A signed-in user names a real MLB team for each side (by name, as `listMlbTeams` offers them). The server builds both lineups with `buildLineup` (`convex/lineup.ts`) and inserts a `scheduled` game, a lineup per side, and the caller as `homeManager` and `awayManager`. The existing `startGame` opens it. It returns the game's id.
- **One transaction, nothing half-written.** Every refusal (not signed in, the same team on both sides, a team `listMlbTeams` does not offer, a player with no recorded playing time) throws, and a throwing Convex mutation writes nothing: no game, lineup or `teams` row.
- **The game carries `pickup: true`.** An optional boolean on `games`, written at creation. It is the contract that a pickup game never counts toward standings; no standings code exists yet. Absent means "not a pickup game", so every earlier game, the dev seed's included, stays valid unchanged.
- **The pre-start envelope is shared.** `convex/scheduledGame.ts` holds the one `SCHEDULED_GAME` that the seed and the pickup mutation both spread in.
- **Out of scope:** another person joining as the opposing manager, the bot as opponent, any screen, lineup editing.

## Alternatives considered

- **Infer "pickup" from ownerless teams.** Works today, but couples a fact about a game to a fact about its teams, and breaks the day a league game uses ownerless teams. An explicit field is one line and says what it means.
- **A `kind` enum on the game.** More than the single distinction needed now; the optional boolean can be widened when a second kind exists.

## Consequences

- **+** A second creation path exists beside the dev seed, with the same envelope.
- **+** Standings code, when written, filters on `pickup` rather than guessing.
- **−** The mutation takes team names, so a team renamed in the source data between listing and picking is refused rather than matched.
