# Attribute normalization — real MLB stats → 1–5 attributes

How a real player's season stats map onto the game's 1–5 attribute scale. Calibrated against 2024 MLB distributions + FanGraphs analyst tier ladders (we reuse the industry's own 5-level thresholds; anchored so league-average = **3**). The scale is **absolute**, not pool-relative. Safe to commit: derived from *public* distributions, not from the source game's IP.

**Method, per attribute:** (1) regress the raw rate toward league average to kill small-sample noise; (2) look up the regressed value in the tier table → integer 1–5.

## Conventions
- **Rates are fractions of their denominator**, scored as written below (13% = 0.13).
- **A value exactly on a band edge takes the better score.** Each table lists the edge the better score *begins* at: "≥" for higher-is-better, "≤" for lower-is-better. There are no gaps between bands.
- **Regress, then bucket.** Every rate except sprint speed is regressed before it is looked up (below).
- **`lg_rate` is the season's own pooled rate**: Σ events ÷ Σ attempts over *every* raw row of that role in the same season, including players later skipped. It is never a constant, so "league average = 3" holds as the run environment moves.
- **Role follows the position the API reports on that row.** `P` → one pitcher row from the pitching stats. Any other lineup slot → one batter row from the hitting stats. The player's other-role row is ignored. `TWP` → both: a batter row (at `DH`) and a pitcher row (at `P`).
- **Nothing is guessed.** A position that is `unknown` or has no lineup slot skips the player, named once in the run report. A pitcher with no outs recorded is skipped (HR/9 has nothing to scale by).
- **A real player is keyed by MLB id + role.** A re-run updates name, position and attributes on the existing row in place.

## Batter cut tables (regressed driver → 5 / 4 / 3 / 2 / 1)
| Attribute | Driver | 5 | 4 | 3 (lg avg) | 2 | 1 |
|---|---|---|---|---|---|---|
| **Power** | ISO = (TB − H) / AB | ≥ .230 | ≥ .180 | ≥ .135 | ≥ .100 | < .100 |
| **Contact** | K% over PA *(lower better)* | ≤ 13% | ≤ 18% | ≤ 24% | ≤ 28% | > 28% |
| **Eye** | BB% over PA | ≥ 14% | ≥ 10.5% | ≥ 7% | ≥ 5% | < 5% |
| **Speed** | Sprint speed (ft/s), **unregressed** | ≥ 29.0 | ≥ 28.0 | ≥ 26.5 | ≥ 25.0 | < 25.0 |

**Speed** is 3 for a batter with fewer than 10 competitive runs or no sprint-speed record.

## Pitcher cut tables
| Attribute | Driver | 5 | 4 | 3 (lg avg) | 2 | 1 |
|---|---|---|---|---|---|---|
| **Velocity** (K ability) | K% over batters faced | ≥ 28% | ≥ 24% | ≥ 20% | ≥ 16% | < 16% |
| **Command** (walk avoid) | BB% over batters faced *(lower better)* | ≤ 6.8% | ≤ 7.7% | ≤ 9.8% | ≤ 11.2% | > 11.2% |

**Movement** (weak contact) = the average of two sub-scores, a half rounding up:
- HR/9 *(lower better)*: 5 ≤ 1.00 · 4 ≤ 1.08 · 3 ≤ 1.25 · 2 ≤ 1.35 · 1 > 1.35. HR/9 is the regressed HR per batter faced (C = 1300) × that pitcher's batters faced per 9 innings (BF × 27 ÷ outs).
- GB% *(higher better)*: 5 ≥ 52% · 4 ≥ 46% · 3 ≥ 40% · 2 ≥ 36% · 1 < 36%. GB% = (ground-ball hits + ground outs) ÷ balls in play.

**Awareness** (run game) — thin attribute; **POC default = 3 for all pitchers**, refine later via Statcast pitcher running-game run value. Lowest-impact of the eight; don't block the build on it.

### Recalibration of Command and Movement (SAN-26, ADR-0038)
The original Command (≤5 / 6.5 / 9 / 11%), HR/9 (≤0.70 / 0.95 / 1.30 / 1.60) and GB% (≥52 / 47 / 41 / 36%) edges did not fit the 2026 pool: Command gave 0.3% 5s and 41% 1s and 2s, and Movement 66% 3s with no 1s. The edges above were set once, by hand, so the 2026 league average (BB% 8.9%, HR/9 1.165, GB% 42.4%) scores 3 in each table and both 5s and 1s appear. They stay fixed (absolute, not pool-relative); the HR/9 edges are tied to 2026's run environment and are revisited by hand, not automatically.

Scores 1 → 5 on the 327 pitchers with ≥50 IP: Command 8.0 / 16.8 / 46.2 / 18.7 / 10.4%; Movement 1.8 / 14.7 / 48.3 / 27.5 / 7.6%.

## Small-sample regression (apply BEFORE bucketing)
`regressed = (events + lg_rate × C) / (attempts + C)`, where C = the Carleton/"Pizza Cutter" stabilization point:

| Stat | C |
|---|---|
| Batter K% | 60 PA |
| Batter BB% | 120 PA |
| ISO | 160 AB |
| Pitcher K% | 70 BF |
| Pitcher BB% | 170 BF |
| GB% | 70 BIP |
| HR/9 | ~1300 BF (very noisy — regress hard; that's why GB% carries half of Movement) |
| Sprint speed | none — require ≥10 competitive runs |

## Draft-pool qualification (frozen-snapshot POC)
Hitters **≥300 PA**, pitchers **≥50 IP** (keeps good relievers). Yields ~150+ hitters + a deep pitching pool; regression handles borderline samples.

## Data sourcing
The ingest (SAN-25, ADR-0037) lands raw rows from the free **MLB Stats API** — hitting, pitching, and the pitching `seasonAdvanced` batted-ball breakdown (GB% needs it) — plus a batched profile lookup for unreported positions and **Baseball Savant's** sprint-speed leaderboard, which feeds **Speed**. **Movement** (whiff/barrel-against) stays a later Statcast polish pass (SAN-29); the POC ships on GB% and HR/9 until then.

## Worked examples (2024, original tables — illustrative)
- **Aaron Judge** → Power 5 / Contact 3 / Eye 5 / Speed 3.
- **Tarik Skubal** → Velocity 5 / Command 5 / Movement 4 / Awareness 3.

## Caveat for the first real data pull
The midpoint check was done on 2026: the recalibration above anchors Command and Movement so the league average is a 3. The hitter tables and Velocity were already well spread on that pool and were left as they were; re-check the buckets (the run report prints each attribute's count at 1–5) when a new season is normalized.

## Design coherence
- MLB players are attribute-**uncapped** (a star can be 5/5/4/5, better than any 12-point custom player); the **salary cap is the balancer** (studs cost more).
- Early-season compression is a **feature**: small samples regress everyone toward 3 ("book isn't out yet"); edges emerge as samples grow, rewarding scouts who read fast-stabilizing peripherals (K%, GB%) early.
