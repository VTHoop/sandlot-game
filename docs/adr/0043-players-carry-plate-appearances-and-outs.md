# 43. `players` carry plate appearances and outs

- Status: Accepted
- Date: 2026-11-24
- Supersedes (in part): ADR-0040 Decision 1, the clause "The set a re-run touches is now those four"

## Context

The lineup builder (SAN-78) picks each position's regular by plate appearances and the starting pitcher by outs recorded. Those numbers live on the raw `mlbSeasonStats` rows, which ADR-0037 keeps internal-only so no public query or mutation reads them. A public mutation that builds a lineup therefore cannot read them where they are.

## Decision

- **`players` gains optional `plateAppearances` (hitters) and `outs` (pitchers).** `normalize.run` writes the one matching the row's role on insert and patches it on a re-run, alongside `name`, `mlbTeam`, `position` and `attributes`. The set a re-run touches is now those five; a price still survives, and players the season no longer lists are still left alone.
- **Copied as reported.** Nothing is derived or defaulted.
- **Optional, never defaulted.** Custom players and rows normalized earlier have neither. The lineup builder refuses a player it must rank who has none, naming `pnpm normalize:mlb`, rather than rank him as zero.
- **The raw table stays internal-only.** Nothing outside `normalize.run` reads it.

## Alternatives considered

- **Open the raw table to a public read.** Reverses ADR-0037 for two numbers.
- **Read it from an internal query the mutation calls.** Mutations can read internal tables directly, but it would key a lineup to a season the player row does not record.

## Consequences

- **+** One indexed read of `players` is enough to build a lineup.
- **−** Existing rows have no playing time until normalize is re-run, so until then every team is refused at pick time even though `listMlbTeams` still offers it.
- **−** A re-run moves a stored player's playing time, so a stored lineup is not retroactively re-ranked (as with trades in ADR-0040).
