# 6. IP, branding & data sourcing

- Status: Accepted
- Date: 2026-06-06

## Context
The core mechanic is adapted from the `r/baseballbythenumbers` community game (a hobbyist Reddit/Discord project). The product uses real MLB statistics. This is a **public** repo and a portfolio piece, so IP hygiene is both a legal-cleanliness matter and a judgment signal.

## Decision
- **Use the mechanic, not the brand or expression.** Game systems/rules are not copyrightable, so the number-duel mechanic is free to build on. We do **not** use the original name, its rules text, or the reverse-engineered calculator's verbatim tuned tables.
- **Re-derive game balance independently** via our own simulation harness, validated against public MLB rate baselines. The reverse-engineered calculator stays a **private reference** for understanding structure — it is **not committed to this repo**.
- **Credit** `r/baseballbythenumbers` as inspiration.
- **Brand:** original, "Sandlot ___" direction (final word TBD); working repo name `sandlot-game`.
- **MLB data:** never commit player data/stats to the repo; fetch at runtime/build into ignored storage. The free MLB Stats API is non-commercial/non-bulk — fine for private play, not redistribution. A public/commercial version would require MLB/MLBPA licensing or a paid provider. This is a known ceiling between "family fun" and "real product."

## Consequences
- **+** Clean IP posture, an ownable brand, a stronger ("I tuned my own balance") engineering story, and a visible IP-judgment signal.
- **−** We must re-derive balance rather than copy it (planned anyway via the sim); the calculator's exact values live outside the repo.
