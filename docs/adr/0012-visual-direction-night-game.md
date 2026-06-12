# 12. Visual direction — "Night Game" + motion-layer policy

- Status: Accepted
- Date: 2026-06-12

---

## Context

Gate 2 of the design spike: pick one visual direction for the at-bat duel before
building high-fidelity screens. Three directions were proposed and prototyped as
tappable lo-fi mockups (`docs/design/direction-protos*.html`):

1. **Dusk Pickup** — dark-first twilight, porch-light amber glow, slab-serif type,
   light-bloom reveal.
2. **Chalk & Clay** — light-first daytime sandlot, clay/chalk/grass materials,
   varsity block type, percussive stamp motion.
3. **The Scorebook** — paper-and-ink, typewriter mono, mechanical split-flap reveal.

The operator's family review converged on a **hybrid**: varsity type (2), split-flap
scoreboard reveal (3), clay/chalk material palette (2), dusk-dark canvas (1). Round-2/3
prototypes tested this hybrid in both lightings, including the reveal → on-field
consequence transition (runners advancing on a diamond), to address the concern that a
dark theme could muddy on-field animation.

## Decision

**"Night Game"** is the visual direction, as a **single primary theme**:

- **Canvas:** deep dusk navy gradient (`#131736 → #0c0f20`) — the night sky is the
  world every screen lives in.
- **Color logic (semantic, strict):**
  - **Dusk navy** = the world (surfaces `#1c2230`, borders `#343c66`)
  - **Chalk** (`#f5f1e6`) = information (text, field lines, numerals)
  - **Amber** (`#ffb454`) = consequence — reserved for the player's committed pick,
    the lock action, the reveal/outcome, and scoring. Amber is the porch
    light/scoreboard bulb: if it isn't a moment of consequence, it isn't amber.
  - **Clay** (`#c2502a` / `#e8744a`) = baseball-material accents (secondary).
- **Type:** Graduate (varsity block) for display/numerals; Archivo for UI text.
- **Signature motifs:** scoreboard tiles (the pick is composed on the same tile the
  reveal flips), split-flap reveal, chalk-dashed diamond diagram, bulb-glow outcomes.
- **The field is a diagram, never an illustration (binding law):** chalk-line diamond +
  token runners. Night Game depends on chalkboard contrast and motion-as-light;
  illustrated/scenic field art is what gets lost on a dark ground and is permanently
  out of bounds for game surfaces.

### Motion-layer policy (considered as part of this gate, per operator request)

- **CSS animations/transitions first.** The full reveal sequence (flap → bulb-glow
  outcome → field consequence) was proven in pure CSS in the prototypes. Zero bytes,
  off-main-thread, ideal in a Capacitor WebView.
- **Motion (formerly Framer Motion, ~30KB)** is the sanctioned second step, added only
  when state-driven choreography exceeds clean CSS (orchestrated sequencing across
  React state transitions, exit animations). Not installed until needed.
- **GSAP** (free since April 2025): documented fallback for a true cinematic
  multi-element timeline set piece; not expected for the duel.
- **Lottie/Rive:** future *authored-asset* pipeline (e.g. celebration flourishes), not
  a code-animation substrate; Rive preferred over Lottie on 2026 performance evidence.
- Respect `prefers-reduced-motion` in every animated component.

### Theming

Build **one theme now**. Author all tokens semantically (`--color-surface`,
`--color-consequence`, …) rather than by hue, so a second theme is a token-swap, not a
refactor. The rejected daylight variant is preserved as a future enhancement spec in
`docs/design/day-game-theme.md`.

## Rejected alternatives

- **Pure Dusk Pickup / Chalk & Clay / Scorebook** as proposed: each lost a
  family-preferred element of the others; the hybrid keeps varsity type, flap reveal,
  and clay/chalk materials in one coherent system.
- **Day Game primary** (same materials, daylight cream): legible and warm, but the
  family preferred the night canvas, and the dark ground demonstrably flatters the
  duel's drama — the reveal blooms as light, runners read as lit points. Preserved as
  a documented future theme, not built.
- **Two-theme system now:** deferred — cost without a current user; semantic tokens
  keep the door open.
