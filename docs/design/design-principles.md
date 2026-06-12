# Sandlot design principles — "Night Game"

> **Who this is for:** any model or human building Sandlot UI after the founding design
> spike (June 2026). These are binding rules, not suggestions. When a screen feels hard
> to design, the answer is almost always "less, on tokens, at night."
> Decisions recorded in ADR-0011 (Tailwind v4 substrate) and ADR-0012 (Night Game
> direction). Live reference: the `/design` showcase route (`src/design/`).

---

## 1. The emotional target

A night game at the sandlot: **dusk sky, chalk lines, one lit scoreboard.** The product
is a slow-burn duel — players visit for one decision, feel one moment of tension, and
leave. Every screen should feel like stepping up to the plate under the lights, not
like operating a dashboard.

- **Tension over information.** The duel screens show the minimum needed to make one
  decision feel weighty. If a stat doesn't change this decision, it doesn't belong here.
- **Warm, hand-marked, nostalgic** — chalk dashes, varsity lettering, scoreboard tiles.
  Never slick, never neon, never sportsbook.
- **The reveal is sacred.** The split-flap → outcome → consequence sequence is the
  product's signature beat. Nothing on a reveal screen may compete with it.

## 2. Color logic (the four-role system)

Every color on screen plays exactly one of four roles. Components reference **semantic
tokens only** (`src/styles/app.css` `@theme`) — never raw hex values, never Tailwind's
stock palette (no `slate-800`, no `amber-400`).

| Role | Tokens | Use for | Never for |
| --- | --- | --- | --- |
| **The world** (dusk navy) | `canvas`, `canvas-high`, `surface`, `edge`, `edge-dim` | backgrounds, tiles, keys, borders | text, emphasis |
| **Information** (chalk) | `chalk`, `muted` | text, field lines, numerals, diagrams | celebration, actions |
| **Consequence** (amber) | `consequence`, `consequence-deep`, `shadow-consequence(-bloom)` | the committed pick, the lock action, the reveal outcome, scoring, "your turn" signals | decoration, headers, links, anything passive |
| **Material** (clay) | `clay`, `clay-bright`, `clay-deep` | secondary accents, opponent runner tokens, small baseball-material details | primary actions, large fills |
| **Presence** (exempt) | `online`, `offline` | small status dots only (opponent presence) | text, fills, buttons, anything larger than a dot |

**The amber rule is the system.** Amber is the porch light / scoreboard bulb: it marks
moments of consequence and nothing else. If amber appears on a screen with no decision
or resolution, the screen is wrong. One amber action per screen, maximum.

**Glow is a token, not a style.** Light effects come only from
`--shadow-consequence(-bloom)` so a future daylight theme can zero them out
(see `docs/design/day-game-theme.md`).

## 3. Typography

- **`font-display` (Graduate, varsity block):** numerals, outcomes, action labels,
  wordmarks. ALL-CAPS, `tracking-wider`. This face IS the brand voice — use it for
  what the scoreboard would say.
- **`font-body` (Archivo):** everything else — situations, helper copy, statuses.
- Display sizes in use: `text-6xl` (the pick), `text-4xl` (outcome, reveal numbers),
  `text-2xl` (page titles), `text-xl`→`text-sm` (buttons, labels). Don't invent
  in-between sizes.
- Label style: `text-[11px] tracking-[0.22em] uppercase text-muted` (see `ScoreTile`).
- Never set body copy in Graduate; never set numerals the player commits in Archivo.

## 4. Spacing & density

- Mobile-first, one-hand reach: primary action in the lower half, thumb-sized targets
  (`py-3` minimum on keys, `py-4` on the lock).
- Spacing rhythm is Tailwind's stock scale; screens compose with `gap-4`/`gap-5` and
  `px-5` gutters. Density belongs to dashboards — this is a ballpark at night; let
  screens breathe.
- The outcome ladder lives at the bottom of the **commit screen only** (it's the
  menu being bet against), always in full (all 10 rungs: HR 3B 2B 1B IF BB FO PO GB
  K), always in engine order. The **reveal carries the `Scoreboard` instead** —
  consequence echoes there (hit ticks at the outcome, run ticks as the runner
  crosses home).
- **The commit screen is one screen for both seats** (ADR-0014): scoreboard
  (runs/hits/inning/outs) → compact field diagram + player matchup (pips, due-up)
  → opponent lock-status chip → number tile → lock. No situation sentence — the
  screen is the situation. Opponent presence (name + green/red dot) lives in the
  chrome's top-right on every duel screen.

## 5. Motion principles

- **Choreography over easing-candy.** Motion exists to pace tension: commit (snap) →
  wait (still) → reveal (flap, held breath, bloom) → consequence (tracer, runners,
  scoreboard tick). The reveal timeline lives in
  `src/design/duel/RevealMotion.tsx` — a designed artifact; don't re-time it casually.
- **Drama is situational, not decorative** (ADR-0013): the held breath before the
  outcome scales with outcome quality *and* leverage (`scenario.ts`: walk-off, lead
  change, new tie, RBI, late-and-close), capped so stacked drama never drags. Routine
  plays resolve fast; big moments earn their pause.
- **Motion reads as light at night**: things that move glow (runner tokens, the
  outcome). Static things don't.
- **Layering** (ADR-0012/0013): CSS for simple loops and token-glow; **Motion** is
  the adopted engine for reveal/state choreography; GSAP only for a true cinematic
  set piece; Rive for authored celebration assets, later.
- **Always honor `prefers-reduced-motion`**: jump to final frames, never strand a
  user mid-sequence (`duel.css` media block, `useReducedMotion` in RevealMotion).
- Waiting states may breathe (slow pulse, drifting fireflies); they must never
  bounce, spin, or demand.

## 5b. The busy-ness budget (binding)

Eye-catching, not busy. Every animated surface obeys:

1. **One new element per beat.** Each reveal beat introduces exactly one thing
   (a tile, the outcome, the callout chip, the field, the tracer, the runners, a
   scoreboard tick). If a new element arrives, the previous one must be at rest.
2. **Two-mover maximum.** Never more than two elements animating simultaneously
   (the two runners are the sanctioned pair).
3. **Amber stays singular** — the busy-ness budget is mostly a color budget.
4. **Ambience only where nothing happens.** Fireflies live on the waiting screen;
   action screens get zero ambient motion.
5. **Baseball richness in diagram language only.** Hit locations are a dashed chalk
   tracer + scorekeeper's ✕ (jittered per play). A full illustrated field is
   permanently rejected (ADR-0012/0013) — that is the "too far" line.
6. **Production sequences must be tap-skippable.** Drama is offered, never imposed
   (applies when the duel is wired to real games; the showcase replays instead).

## 6. The two laws

1. **Secret state never touches the client.** The batter's UI may know *that* the
   pitch is locked — never the number, not in props, not in the DOM, not in layout
   differences, not in animation hints. The locked badge is static and identical
   regardless of the pitch. (Enforced server-side per AGENTS.md; the UI must also
   never create a surface that *could* leak. Test:
   `DesignShowcase.test.tsx` "NEVER renders the opponent's number".)
2. **The field is a diagram, never an illustration.** Chalk-dashed diamond, token
   runners (`FieldDiagram`). No scenic art, no drawn players, no grass textures on
   game surfaces — Night Game's legibility depends on chalkboard contrast.

## 7. Component foundation (reuse before recreating)

Extracted from the duel — search `src/components/ui/` before building anything:

- **`Button`** — variants `consequence` (one per screen, the decisive act), `surface`
  (keys, tabs), `ghost` (quiet escape hatches). Never a raw `<button>` in screens.
- **`ScoreTile`** — any committed/displayed number. The pick is composed on the same
  tile the reveal flips; keep that continuity.
- **`ScoreTileInput`** — the only input for duel numbers (ADR-0014): the scoreboard
  tile as a styled `inputMode="numeric"` field driven by the device keyboard. No
  sliders, no spinners, nothing that looks like a browser default.
- **`AttributePips`** — 1–5 ratings as chalk pips; the matchup card's vocabulary.
- **`OutcomeLadder`** — the fixed best→worst strip; `highlight` marks a resolved
  outcome. Outcome keys mirror the engine's band names. Decision screens only.
- **`Scoreboard`** — the lit-scoreboard strip (runs + hits per team, inning); values
  split-flap tick amber→chalk when they change. The reveal's consequence echo and the
  waiting screen's status line.
- **`Card`** — grouped content on a surface panel.

## 8. Do / Don't

| Do | Don't |
| --- | --- |
| Compose every color from the four-role tokens | Use Tailwind stock colors or raw hex in components |
| One amber action per screen | Amber headers, amber decoration, two competing CTAs |
| ALL-CAPS Graduate for scoreboard-voice text | Graduate body paragraphs, mixed-case display |
| Chalk-dash motifs, scoreboard tiles, bulb glows | Gradients-as-decoration, glassmorphism, neon, drop-shadow soup |
| Keep waiting states calm and reassuring | Spinners, skeleton shimmer, countdown pressure |
| Let the reveal own its screen | Toasts/badges/nav competing with the reveal |
| `motion-safe`/`motion-reduce` aware animation | Auto-playing motion a user can't opt out of |
| Extend `@theme` tokens when something is truly missing | One-off arbitrary values (`p-[13px]`, `text-[#ffb454]`) |
