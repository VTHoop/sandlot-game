# Attribute normalization — real MLB stats → 1–5 attributes

How a real player's season stats map onto the game's 1–5 attribute scale. Calibrated against 2024 MLB distributions + FanGraphs analyst tier ladders (we reuse the industry's own 5-level thresholds; anchored so league-average = **3**). The scale is **absolute**, not pool-relative. Safe to commit: derived from *public* distributions, not from the source game's IP.

**Method, per attribute:** (1) regress the raw rate toward league average to kill small-sample noise; (2) look up the regressed value in the tier table → integer 1–5.

## Batter cut tables (regressed driver → 5 / 4 / 3 / 2 / 1)
| Attribute | Driver | 5 | 4 | 3 (lg avg) | 2 | 1 |
|---|---|---|---|---|---|---|
| **Power** | ISO | ≥.230 | .180–.229 | .135–.179 | .100–.134 | <.100 |
| **Contact** | K% *(lower better)* | ≤13% | 13–18% | 18–24% | 24–28% | >28% |
| **Eye** | BB% | ≥14% | 10.5–14% | 7–10.5% | 5–7% | <5% |
| **Speed** | Sprint speed (ft/s) | ≥29.0 | 28.0–28.9 | 26.5–27.9 | 25.0–26.4 | <25.0 |

## Pitcher cut tables
| Attribute | Driver | 5 | 4 | 3 (lg avg) | 2 | 1 |
|---|---|---|---|---|---|---|
| **Velocity** (K ability) | K% | ≥28% | 24–28% | 20–24% | 16–20% | <16% |
| **Command** (walk avoid) | BB% *(lower better)* | ≤5% | 5–6.5% | 6.5–9% | 9–11% | >11% |

**Movement** (weak contact) = round the average of two sub-scores:
- HR/9 *(lower better)*: 5 ≤0.70 · 4 0.70–0.95 · 3 0.95–1.30 · 2 1.30–1.60 · 1 >1.60
- GB% *(higher better)*: 5 ≥52% · 4 47–52% · 3 41–47% · 2 36–41% · 1 <36%

**Awareness** (run game) — thin attribute; **POC default = 3 for all pitchers**, refine later via Statcast pitcher running-game run value. Lowest-impact of the eight; don't block the build on it.

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
6 of 8 attributes come from the free **MLB Stats API** (hitting + pitching, two calls). **Speed** (sprint speed) and **Movement** (whiff/barrel-against) are better from **Baseball Savant / pybaseball** — add as a later polish pass; the POC ships on the Stats API + the proxies above.

## Worked examples (2024)
- **Aaron Judge** → Power 5 / Contact 3 / Eye 5 / Speed 3.
- **Tarik Skubal** → Velocity 5 / Command 5 / Movement 4 / Awareness 3.

## Caveat for the first real data pull
Anchor the "3" midpoint to the actual qualified-player **median** (from the FanGraphs CSV), not the raw league mean — qualified hitters skew a bit better than the league as a whole. Sanity-check the buckets and nudge if one is lopsided.

## Design coherence
- MLB players are attribute-**uncapped** (a star can be 5/5/4/5, better than any 12-point custom player); the **salary cap is the balancer** (studs cost more).
- Early-season compression is a **feature**: small samples regress everyone toward 3 ("book isn't out yet"); edges emerge as samples grow, rewarding scouts who read fast-stabilizing peripherals (K%, GB%) early.
