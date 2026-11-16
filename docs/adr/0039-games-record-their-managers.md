# 39. A game records who manages each side; team ownership grants nothing in it

- Status: Accepted
- Date: 2026-11-16
- Supersedes: the seed-held bot definition in ADR-0027 (§ Decision, § Consequences), and the parts of ADR-0028 that restate it and that justify one account holding both teams

## Context

Every question of "who is in this game" was answered by `teams.owner`. One field
did three jobs: franchise, roster holder, and permission to commit a number. It
needed workarounds:

- The bot was "whichever team the seed account owns" (ADR-0027), and only where
  the dev seed was enabled.
- Hotseat was one account owning both teams (ADR-0028).
- Reassigning a team changed who was playing every game the team was already in,
  which is why `dev:game` needed `--force`.
- A pickup game between two people who own no teams could not be expressed.

## Decision

**A game records a manager for each side, home and away.** A manager is a user
or the bot (`games.homeManager`, `games.awayManager`; `manager` in
`convex/validators.ts`). They are written when the game is created and never
patched: no function changes them.

**The server decides who may act from those two managers, never from team
ownership.** Participation and commit checks, the game and last-at-bat reads, the
"My games" list and the manager name it shows, and push and reminder recipients
all read `managersOf(game)` (`convex/participants.ts`). A user who owns a team in
a game but manages neither side is refused every commit, cannot read the game,
and sees nothing of it in "My games" or in pushes.

**The bot plays a side exactly when the game names the bot as that side's
manager.** The dev-seed flag and the seed account no longer decide it. A
user-managed side whose team the seed account owns is never played by the bot.

**One account may manage both sides** (hotseat); it commits in either seat in
both halves.

**Backfill.** `seed.backfillGameManagers` (internal) fills the managers of
existing games from their teams' current owners. A side whose team the seed
account holds, while the seed is enabled, becomes bot-managed. A team or owner
that no longer exists fails the run; no game is skipped.

**Rollout.** The two schema fields are optional until the backfill has run on
every deployment. Every reader goes through `managersOf`, which throws on a
missing manager rather than guess. Making the fields required is a follow-up.

**Vocabulary** (`docs/CONTEXT.md`): an *owner* holds a team; a *manager* runs a
side of one game; a *seat* is only the pitcher or batter role in the open at-bat.
"Club" is a retired synonym for team.

## Consequences

- `seed.assignClubToUser` and `dev:game --force` are removed. `dev:game` writes
  the named accounts as the new game's managers and leaves team ownership and
  earlier games alone; `--home-bot` / `--away-bot` make either side bot-managed.
- Changing a team's owner leaves the managers of existing games alone.
- What ownership means for leagues, and how a league game's managers are chosen,
  belongs to the schedule work (SAN-34). Where ownership lives, and whether
  `teams.owner` stays required, is left to SAN-34 and SAN-78.
- Both sides bot-managed is still out of scope (ADR-0027 § Consequences) and
  `dev:game` refuses it.
- `games` gains `by_home_manager` / `by_away_manager` indexes, which "My games"
  reads in place of `teams.by_owner`.
