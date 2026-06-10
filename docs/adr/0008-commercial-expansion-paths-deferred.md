# 8. Commercial expansion paths (deferred): fictional universe first, real names later

- Status: Accepted
- Date: 2026-06-10

## Context
ADR-0006 frames MLB/MLBPA licensing as the hard ceiling between "family fun" and "real product." That framing is too strong in one respect: *C.B.C. Distribution v. MLB Advanced Media* (8th Cir. 2007) — the precedent the fantasy-sports industry stands on — established that real player **names + statistics** may be used in fantasy games **without** an MLBPA license: stats are uncopyrightable facts (*NBA v. Motorola*), and publicity-rights claims lost to the First Amendment.

What actually binds a commercial version:
1. **Trademarks** — team names, logos, uniforms always require a license. Avoidable by not using them.
2. **The data-pipe contract** — the free MLB Stats API ToS is non-commercial/non-bulk; a commercial product needs a paid provider or independently compiled public facts. This binds regardless of any masking of the output.
3. **Practical enforcement** — rights holders send letters even where precedent is against them, and app stores pull first and adjudicate never. Partially mitigated by shipping as a PWA.

The beta is private and non-commercial; nothing changes now. This ADR records the post-beta options so the architecture keeps them open.

## Decision
Defer commercialization. Record two viable expansion paths, one rejected path, and one architectural guard.

### Path B — fictional universe (foundation candidate)
- **Distribution-modeled players:** study public MLB distributions once to learn the league's statistical *shape* (the work in `docs/engine/attribute-normalization.md` is most of this), then generate a fully fictional player pool from those patterns. No fictional player corresponds to any real one — there is no mapping to crack and no ongoing data dependency.
- **Simulated living season:** each fictional player carries *hidden* true talent; visible stats update weekly as truth + realistic noise, stabilizing as samples grow. This recreates the scouting metagame ("spot the breakout before ratings and prices catch up") with the information-release dials under our control instead of inherited from the real season.
- Zero IP/data constraints; ownable universe IP (cf. Blaseball, OOTP fictional leagues). The 12-point signature player is the seed of this system.

### Path A2 — real names + stats, unlicensed (later mode)
CBC-backed use of player names and statistics with **no team marks**: legally defensible per the precedent above, but requires a compliant paid data feed and tolerance for rights-holder noise. Suitable as a revenue-funded *mode* layered on Path B, not as the foundation.

### Rejected — persistent 1:1 masking
Real stats mapped persistently to fictional identities pays the fictional path's product cost (no recognition hook) while keeping the real-data path's obligations (the same commercial data pipe), and the mapping is trivially inferred from attribute movements — community decoder spreadsheets defeat it regardless of the mapping code living in a private repo.

### Architectural guard (costs nothing now)
The engine consumes only 1–5 attributes. Keep the player-pool provider behind a clean interface so the pool source — real-API snapshot today, generated universe or paid feed later — is swappable without touching the engine, cap, draft, or league layers.

## Consequences
- **+** The beta proceeds unchanged (private play, free MLB Stats API).
- **+** Expansion options are recorded with rationale while they're fresh, and the player-pool seam keeps both open at near-zero cost.
- **−** Path B, if pursued, means real new product work: the season-simulation generator and universe content (names, identity, lore) — a fictional league needs *character* to matter.
- This ADR **extends** ADR-0006 rather than superseding it: all of its hygiene rules (never commit MLB data, no third-party tuned tables, credit `r/baseballbythenumbers`) remain in force.
