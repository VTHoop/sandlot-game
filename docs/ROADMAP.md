# Sandlot — Roadmap (Linear import draft)

Mirror of the Linear plan. Structure: **Initiative → Projects → Issues**. Priorities: **P0** = critical path to a playable slice · **P1** = needed for the beta · **P2** = polish / later. *(Linear updates managed manually; MCP disabled.)*

> Suggested build order follows the critical path: **Engine → Multiplayer loop (secret at-bat round-trip) → Data pipeline → Roster/cap → League → UX polish.** Foundation (P0) underpins all of it.

---

## Initiative: Sandlot Beta — 6-team family-league POC
Prove the core loop is fun and that the async social dynamic creates pull, among ~6 family members.

---

### Project: Foundation & Tooling  *(P0)*
- [P0] Create public GitHub repo; push AGENTS.md/CLAUDE.md/docs
- [P0] Scaffold pnpm + TypeScript + Vite + React; Convex project; Clerk
- [P0] Wire toolchain: Biome, `tsc`, Vitest (v8 coverage, new-code gate), Playwright smoke lane
- [P0] Pre-commit/pre-push + CI: lint, typecheck, test, coverage, Codacy, CodeScene; `.codescene-thresholds`
- [P0] TDD enforcement hook (run checks after edits; block test weakening)
- [P1] Set up Linear workspace; import this roadmap; optional Convex/Linear/Codacy/CodeScene MCP servers

### Project: At-Bat Engine & Simulation  *(P0 — the core)*
> Terminology (*RangeFinder*, *outcome bands*, *front/back half*, *"the sheet"*): see `docs/engine/at-bat-model.md`.
- [P0] Port RangeFinder **front half** (HR→BB cumulative bands) to pure TS; parity-test against local fixtures (skipped in CI); committed tests assert band-structure invariants
- [P0] Reference tables: local gitignored parity fixtures + committed seed tables derived from public MLB rates
- [P0] Implement the **elastic back half** (FO/PO/GB/K); verify by simulation
- [P0] **Monte Carlo harness** — sim N at-bats/games; report AVG/OBP/SLG/HR%/K%/BB%/runs-per-game
- [P1] Tune tables vs real MLB rate baselines (independent balance — see ADR-0006)
- [P1] Ground-ball sub-resolution (FC/DP/TP by base-state + outs + speed)
- [P1] Steals, bunts, extra-base/deep-fly, park effects
- [P2] Derive attribute → run-value → price from the sim (feeds salary cap)

### Project: Core Multiplayer Loop  *(P0/P1 — Convex)*
- [P0] Convex schema: games, teams, lineups, players, **pitches (secret)**, at_bats (append-only log), rollups
- [P0] **Secret at-bat round-trip**: pitch mutation (vault) → swing mutation → server resolution → result; test asserting batter can't read the pitch
- [P0] Game state machine (innings/outs/bases/score) via authoritative mutations
- [P1] Realtime subscriptions (live at-bat: "pitch is in" → swing → shared result)
- [P1] Web push (VAPID) "it's your turn"; scheduled turn reminders
- [P1] Async turn handling + timeouts

### Project: Data Pipeline  *(P1)*
- [P1] MLB Stats API ingest (2 calls: hitting + pitching), full-season snapshot
- [P1] Stat → 1–5 attribute normalization (cut tables + small-sample regression — per spec)
- [P1] Draft-pool qualification (hitters ≥300 PA, pitchers ≥50 IP)
- [P2] Weekly scheduled refresh (Convex cron); the "scouting edge"
- [P2] Statcast/pybaseball polish for Speed (sprint speed) + pitcher Movement

### Project: Roster & Salary Cap  *(P1)*
- [P1] Custom signature player creation (12-point build, off-cap)
- [P1] Player-pool browser (filter/sort/search by position/attribute/price)
- [P1] Salary-cap roster build (shared pool; positional requirements; $1 floor; calibrate so all-elite busts the cap)
- [P1] Deadline + greedy-knapsack autodraft fallback

### Project: League & Season  *(P1/P2)*
- [P1] 6 teams + schedule
- [P1] Standings + box scores (maintained rollups)
- [P2] Season flow, playoffs, awards
- [P2] Career / head-to-head stat lines (the "vs your nephew" splits)

### Project: Web App / UX  *(P1/P2)*
- [P1] PWA shell (installable, mobile-first), Clerk auth screens
- [P1] At-bat UI (pitch/swing entry, secret-safe), field + bases, scoreboard
- [P1] Lineup management; near-miss/odds preview (client-side engine read)
- [P2] Replays from the at-bat log; trash-talk-friendly result sharing
- [P2] Visual polish; brand pass (lock "Sandlot ___" name)

---

### Future expansion (post-beta — see [ADR-0008](./adr/0008-commercial-expansion-paths-deferred.md))
Not scheduled; recorded so the architecture keeps them open. The only guard that costs anything now: keep the player-pool provider behind a clean interface (the engine sees only 1–5 attributes).
- **Path B — fictional universe:** distribution-modeled player generation + simulated living season (hidden true talent, noisy weekly stats) to recreate the scouting metagame without real-world data.
- **Path A2 — real names mode:** CBC-backed names + stats (no team marks) on a paid data feed, as a revenue-funded mode on top of Path B.
