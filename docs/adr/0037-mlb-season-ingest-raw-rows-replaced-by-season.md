# 37. MLB season ingest: raw rows, validated whole, replaced by season

- Status: Accepted
- Date: 2026-10-26

## Context
SAN-26 turns real stats into the 1–5 attributes `players` requires, so something has to land the stats first. ADR-0006 forbids committing MLB data and calls the free Stats API non-commercial; ADR-0002 expects a weekly cron to re-ingest; `docs/engine/attribute-normalization.md` names the drivers. Two things the doc did not settle: GB% and Speed come from places the first two Stats API calls do not reach (the batted-ball breakdown, and Baseball Savant's sprint-speed leaderboard), and a re-run must neither duplicate rows nor leave a season half-written.

## Decision
- **Raw rows, one table.** `mlbSeasonStats` holds one row per player per role per season, a union of a hitter and a pitcher shape (`convex/validators.ts`). It is not `players`: those need attributes, which are SAN-26's. Only `internal` functions touch it — no client reads raw stats.
- **Five sources, all read before anything is written.** The Stats API hitting, pitching and `seasonAdvanced` pitching groups (one request each, `playerPool=ALL`, so no qualification filter — that is SAN-27), a batched `/people` lookup for players the stats report at position `X`, and the Savant sprint-speed CSV. A season given as no argument comes from `/seasons/all`: the latest whose `regularSeasonEndDate` is before today.
- **Validate whole, then replace.** `ingest.run` (an action) fetches and runs everything through `mlbStats.buildSeasonRows`, which throws an `IngestError` naming the source for a failed request, an empty answer, or a record missing a required field; only then does it call `ingest.replaceSeason`, one transaction that deletes the season's rows and inserts the new ones. A failed run therefore never reaches a write, and a re-run leaves exactly one row per player per role, with players the source no longer lists gone.
- **Nothing is guessed.** A position the stats call `X` is replaced by the profile's listed primary position, and stored as `unknown` when that is missing too. A hitter with no Savant record has no sprint fields. Innings pitched is stored as whole `outs`, which the API already reports, so no decimal-innings arithmetic reaches SAN-26.
- **Position stays the source's string** (`TWP`, `DH`, `unknown`, …), not the engine's ten slots; mapping is SAN-26's.
- **Field reads are by name through a `Map`** (`mlbFields.Fields`), never a computed index, so a wrong shape fails with the source's name instead of becoming `undefined`.
- **Command.** `pnpm ingest:mlb [--season YYYY]` wraps `npx convex run ingest:run`. SAN-28's cron calls the same action with the live season.

## Alternatives considered
- **Upsert by `(season, mlbId, role)`.** Keeps unchanged rows, but needs a read per row and cannot drop a player the source stops listing. Replacing a season is about 3,200 writes, under Convex's 16,000 documents written per mutation.
- **Fetch inside the mutation.** Not possible; mutations cannot call out.
- **Compute the default season from the calendar.** Cheaper, but a guess; the seasons endpoint states it.
- **Leave sprint speed to SAN-29 with Statcast.** SAN-26 decided Speed uses it now.

## Consequences
- **+** A failed source cannot corrupt a season; SAN-26 reads one honest table; the same action serves the command and the cron.
- **−** The Savant CSV is a public download, not a documented API, on the same non-commercial footing as the Stats API (ADR-0006, ADR-0008); a column rename aborts the run loudly, by design.
- **−** One season is one mutation. A pool several times larger would have to be chunked.
- **Open question:** whether the team the API reports for a traded player is the last one is unconfirmed; the row stores whatever it reports, with `numTeams`.
