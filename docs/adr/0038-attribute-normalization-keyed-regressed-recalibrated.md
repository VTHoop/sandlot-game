# 38. Attribute normalization: players keyed by MLB id + role, rates regressed against the season, Command and Movement recalibrated on 2026

- Status: Accepted
- Date: 2026-10-27

## Context
SAN-25 (ADR-0037) lands a season's raw stats in `mlbSeasonStats`. `players` needs 1–5 attributes, so SAN-26 turns one into the other, following `docs/engine/attribute-normalization.md`. The doc fixed the method (regress, then look up a cut table) but left four things to decide: what identifies a real player across re-runs, what the league average is regressed toward, how the API's position strings map to a role, and whether its Command and Movement tables fit the data. A probe of the 2026 pool (≥50 IP) showed they did not: with the doc's tables Command gave 0.3% 5s and 41% 1s and 2s, and Movement 66% 3s, 0.3% 5s and no 1s, while the hitter tables and Velocity were well spread.

## Decision
- **A real player is `players.mlbId` + `role`.** `mlbId` is an optional field with a `by_mlb_id` index on `[mlbId, role]`; custom players have none. A two-way player is one MLB id with two roles, so two rows. `normalize.run` reads that index range before writing, so a concurrent run conflicts and retries rather than doubling a row (no uniqueness column; AGENTS.md → Concurrency by OCC). A re-run patches `name`, `position` and `attributes` and nothing else — a price survives — and players the season no longer lists are left alone.
- **The league rate is pooled over every raw row of the season, skipped players included.** `lg_rate = Σ events / Σ attempts` per role, so one definition serves K%, BB%, ISO, GB% and HR per batter faced. Regressing toward the pool the season actually produced, rather than a constant, keeps "average = 3" true as the run environment moves.
- **Role follows the position on each raw row.** `P` and `TWP` make a pitcher row; any other slot makes a hitter row (`TWP` hits at `DH`); the other-role row a player also has is ignored. In 2026 the API reports the one two-way player's hitting row as `DH` and the pitching row as `TWP`, which this reads correctly. A position the engine has no slot for (`unknown`, or anything outside the ten slots) skips the player, named once in the report — never guessed (AGENTS.md → Refuse rather than guess). A pitcher with no outs recorded is skipped too, because HR/9 scales by batters faced per nine innings and has nothing to divide by.
- **Command and Movement are recalibrated once, by hand, and then fixed.** They stay absolute tables. The edges were chosen on the 2026 pool so the league average lands mid-band (3) and both ends are populated:

  | Table | 5 | 4 | 3 | 2 | 1 | League 2026 → |
  |---|---|---|---|---|---|---|
  | Command, BB% (was ≤5 / 6.5 / 9 / 11) | ≤6.8% | ≤7.7% | ≤9.8% | ≤11.2% | >11.2% | 8.89% → 3 |
  | Movement, HR/9 (was ≤0.70 / 0.95 / 1.30 / 1.60) | ≤1.00 | ≤1.08 | ≤1.25 | ≤1.35 | >1.35 | 1.165 → 3 |
  | Movement, GB% (was ≥52 / 47 / 41 / 36) | ≥52% | ≥46% | ≥40% | ≥36% | <36% | 42.4% → 3 |

  Resulting scores 1→5 (share of the 327 pitchers with ≥50 IP): Command 8.0 / 16.8 / 46.2 / 18.7 / 10.4%; Movement 1.8 / 14.7 / 48.3 / 27.5 / 7.6%. Across all 812 pitchers: Command 71 / 177 / 431 / 91 / 42, Movement 13 / 199 / 408 / 165 / 27.
- **Pure scoring, then a thin writer.** `convex/attributes.ts` is regression and cut tables; `convex/seasonPlayers.ts` plans rows into players, skips and histograms; `convex/normalize.ts` reads and writes in one `internalMutation`. `pnpm normalize:mlb --season YYYY` wraps `npx convex run normalize:run`. The season is required: with no raw rows for it the run throws, and no public query or mutation exists.

## Alternatives considered
- **Regress toward a fixed constant** (the doc's 2024 averages). Simple, but "average = 3" would silently drift every season the run environment moves.
- **Pool-relative buckets** (percentiles). Rejected by the doc: the scale is absolute, so a pitcher's score does not depend on who else is drafted.
- **Upsert by name.** Names collide and change; the MLB id does not.
- **Widen `position` to hold `OF`/`X`/`TWP`.** It would push API strings into the engine's domain. Skipping by name is smaller and the 2026 data needed none.
- **A `claimed`/`pending` state or lock for concurrent runs.** The index read already serializes them.

## Consequences
- **+** One command rebuilds a season's players idempotently; the numbers it produces are reproducible from the raw rows alone.
- **+** The report names every skip and shows each attribute's spread, so a lopsided table is visible the first time it runs on new data.
- **−** The recalibrated HR/9 edges are tied to 2026's run environment (pooled 1.165 per nine). A very different season would need the tables revisited by hand — deliberately, since an automatic fit would make scores pool-relative.
- **−** Normalization reads and writes about 1,500 rows in one mutation, comfortably under Convex's per-mutation limits, but a pool several times larger would have to be chunked (as in ADR-0037).
- **Follow-up (not here):** the draft-pool qualification filter (SAN-27) and pricing (ROADMAP P2) build on these rows.
