# 11. Styling substrate — Tailwind CSS v4 over CSS-variable design tokens

- Status: Accepted
- Date: 2026-06-12

---

## Context

The design spike (duel screen, design-principles doc, token foundation) needs a styling
substrate before any screen is built. Constraints from the brief:

1. Vite + React 18 PWA, mobile-first; no styling tooling installed yet.
2. We **own the components** — no third-party design language; the brand is bespoke
   ("Sandlot ___": warm, hand-stitched, dusk-pickup-game charm).
3. Strong accessibility story.
4. The design judgment captured this session must remain **enforceable by
   less-capable models later** — the substrate should keep future agents on token
   rails mechanically, not just by convention.
5. App-store distribution, if it ever happens, will be a **Capacitor wrap** of the
   existing PWA (operator decision, 2026-06-12) — not a React Native rewrite. All web
   CSS therefore carries over unchanged; runtime styling cost inside a WebView is the
   property to minimize, and web↔native style portability is a non-requirement.

The decision was research-backed (live web research, June 2026), per the spike brief's
explicit instruction not to default to Tailwind from training-data reflex.

## Decision

Adopt **Tailwind CSS v4** as the styling substrate:

- Design tokens declared in a CSS-first `@theme` block, which compiles to **real CSS
  custom properties** on `:root` — consumable from utility classes, handwritten CSS,
  and JS alike.
- Day-to-day component styling via utility classes; the bespoke dramatic work (reveal
  choreography, textures) is handwritten CSS in `@layer components` using the same
  token variables.
- Zero runtime: all styling is build-time static CSS (ideal in a Capacitor WebView).
- Headless primitives (Base UI 1.0 / React Aria) remain available for complex widgets
  as a separate, substrate-independent accessibility layer; not adopted until a duel
  widget needs one.
- The motion/animation layer (CSS animations vs Motion vs GSAP vs Lottie/Rive) is a
  **separate decision**, folded into the Gate 2 visual-direction ADR — it sits on top
  of the substrate and does not compete with it.

## Rationale

- **Maintenance momentum** (decisive): Tailwind is the most actively maintained
  styling project in the ecosystem — v4.2 (Feb 2026), v4.3 (May 2026). The
  zero-runtime CSS-in-JS alternatives all showed stalled momentum when checked
  directly: vanilla-extract's last releases were April 2025 (~14 months stale at
  decision time); Panda CSS activity thins after mid-2025.
- **Token enforcement** (decisive, per constraint 4): a constrained utility vocabulary
  means future agents can only compose tokens that exist. With freeform CSS, a typo'd
  `var(--color-clay-500)` fails silently and off-token values drift in unnoticed.
- **No ownership cost**: Tailwind is a vocabulary, not a component library; 100% of
  components remain ours, and v4's `@theme` keeps the token source of truth in plain
  CSS custom properties (no lock-in for the tokens themselves).
- **Runtime CSS-in-JS is disqualified outright**: styled-components entered
  maintenance mode (March 2025); runtime style computation is the wrong cost profile
  inside a WebView.

## Rejected alternative — vanilla CSS Modules + `:root` custom-property tokens

The serious contender. Zero dependencies (Vite-native), zero churn risk forever,
maximal bespoke freedom, identical WebView performance. Rejected because token
discipline would live only in prose conventions that every future model must read and
honor, with no mechanical enforcement — directly against constraint 4. It remains the
fallback if Tailwind's maintenance ever falters: the `@theme` tokens are plain CSS
variables, so an exit migration is mechanical.

## Also considered and cut earlier in the funnel

- **vanilla-extract / Panda CSS / StyleX / Linaria** (zero-runtime CSS-in-JS): right
  architecture, stalled or niche momentum; StyleX solves Meta-scale constraints we
  don't have.
- **MUI / Mantine / Chakra / HeroUI** (styled component libraries): violate the
  own-the-components constraint; heaviest runtime footprint.
- **Tamagui / NativeWind / react-strict-dom** (universal web+native styling):
  eliminated by the Capacitor decision — their value is surviving an RN rewrite we are
  not planning; their cost (RN-subset styling) pinches exactly on the bespoke
  pseudo-element/keyframe work the duel needs. Tamagui v2 was also still in RC.
- **UnoCSS**: healthy and flexible, but tracks Tailwind's vocabulary via compat
  presets; the de-facto standard wins for agent legibility.
- **Sass**: obsoleted by native CSS nesting, layers, and custom properties.

## Sources (researched 2026-06-12)

- Tailwind v4 releases & theme model: tailwindcss.com/blog; tailwindcss.com/docs/theme;
  InfoQ on v4.2 (Apr 2026)
- styled-components maintenance mode: sanity.io/blog/cut-styled-components-into-pieces-this-is-our-last-resort;
  github.com/orgs/styled-components/discussions/5657
- vanilla-extract staleness: github.com/vanilla-extract-css/vanilla-extract/releases
  (latest: April 2025); Panda: github.com/chakra-ui/panda/releases
- Headless layer health: InfoQ on Base UI 1.0 (Feb 2026); LogRocket headless-UI comparison
- Capacitor wrap path: capacitorjs.com/docs/web/progressive-web-apps;
  nextnative.dev/blog/capacitor-vs-react-native
- Universal styling: github.com/tamagui/tamagui (v2 RC, Feb 2026); nativewind.dev/v5
  (Tailwind v4 alignment still preview)
- UnoCSS positioning: unocss.dev/presets/wind4; pkgpulse.com/guides/tailwind-vs-unocss-2026
