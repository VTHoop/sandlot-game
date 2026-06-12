# Design spike prompt — Sandlot: design direction + the at-bat duel

> Hand this to the high-capability UI/UX model in its own session. It won't have this
> repo's memory or prior context, so the brief is deliberately self-contained.

---

You're working in an existing repo, `sandlot-game`: a **Vite + React 18 + TypeScript +
Convex + Clerk PWA**, mobile-first. No CSS framework or component library is installed
yet — you'll set up whichever styling substrate we agree on (see the first gate below).
Do not touch the backend, Convex, or auth; this is a front-end design spike only.

## What the app is
A **6-team, async-first family baseball league** played as a PWA. "Async-first" means a
game unfolds one at-bat at a time over hours or days — like correspondence chess, not a
live broadcast. Players get a "your turn" nudge, open the app, make one decision, and
leave. The whole product lives or dies on whether that turn-taking feels tense and fun
on a phone.

## The core mechanic you're designing for (the "duel")
Each at-bat is a blind number duel between two human managers:
- The **pitcher** secretly picks a number 1–1000 and locks it. It is never revealed to
  the batter until both have committed.
- The **batter** then picks a number 1–1000, blind.
- The server folds the difference between the two numbers into an outcome on a fixed
  ladder — best to worst: HR → 3B → 2B → 1B → infield single → walk → fly out → pop out
  → groundout → strikeout. Each player's 1–5 attribute ratings (Power, Contact, Speed,
  Eye, etc. vs the pitcher's Velocity, Movement, Command…) resize the odds bands, so a
  good hitter has wider "good outcome" zones.
- The drama is in the **blind commit and the reveal**: you're trying to read your
  opponent, you lock your guess, then both numbers flip and the outcome resolves.

**Hard constraint (secret state):** the batter must NEVER be able to see or infer the
pitcher's locked number before committing their own. Design the UI so there is no
surface — no preview, no animation hint, no shared layout space — that leaks it. Respect
this in every state.

## IP constraint (important)
This is a clean-room reimagining inspired by an old community spreadsheet game. Do NOT
reproduce that game's brand, name, rules text, or visual identity. Original work only.
The brand direction is **"Sandlot ___"** (final word TBD) — a warm, nostalgic
backyard/sandlot baseball feeling, not a slick Vegas sportsbook. Lean into that: think
hand-stitched, chalk-line, dusk-pickup-game charm rendered in a clean modern mobile UI.

## Two sign-off gates before you build anything
Get my explicit pick on each, in order, before generating screens:

**Gate 1 — Styling substrate (research-backed, not from memory).** Before proposing
anything, **run a real research pass** — use your web-search / live-documentation tools to
check the *current* (mid-2026) state of the React styling landscape: which options are
actively maintained, their recent releases, ecosystem health, accessibility story, and
PWA/mobile fit. Do **not** propose from training-data recall alone, and do **not**
silently default to Tailwind because it's the common reflex — that default is exactly
what this gate exists to interrogate. Then propose exactly **two** realistic substrate
options for this stack (Vite + React PWA where I want to *own* my components and keep
strong accessibility), each with honest, **sourced** tradeoffs — velocity, a11y, who owns
the component code, bundle/runtime, maintenance momentum, and mobile-first fit. Cite what
you found. Recommend one and say why; justify it against the real alternative (or argue
for the alternative). Once I pick, record the decision as a short ADR in `docs/adr/`
(next available number, following the existing ADR format), including the rejected option,
the rationale, and the sources/date of the research.

**Gate 2 — Visual direction.** Propose **2–3 distinct visual directions** for the duel
(quick — mood, palette logic, type personality, motion feel). I pick one; then go deep
on that one. Record the chosen direction as a second short ADR.

## Your deliverables (after both gates)
1. **A design direction brief / principles doc** — committed as
   `docs/design/design-principles.md`. Capture the taste decisions as *rules a
   less-capable model can later follow*: color logic, typography scale, spacing/density,
   motion principles, the emotional tone, do's and don'ts. This is the most important
   artifact — it's how your judgment survives after this session.
2. **The at-bat duel at high fidelity** — design and build it as real components (in the
   agreed substrate) on a **parked `/design` showcase route** (or a `feat/design-spike`
   branch), NOT wired into the live app. Cover every state, for BOTH seats:
   - pitcher: picking + locking the secret number
   - batter: the blind commit (with the secret respected)
   - the reveal + outcome resolution (the dramatic beat)
   - the waiting / "it's their turn" async state
   Make the blind-commit-and-reveal feel tense and great on a phone.
3. **A minimal token + component foundation extracted FROM the duel** — the theme/tokens
   and the handful of core components the duel actually needed (buttons, the number
   picker, cards, the outcome ladder). Don't invent a top-down design system; codify only
   what the real screen used.
4. **Two ADRs** (from the gates above): the styling-substrate decision and the
   visual-direction decision, each recording the rejected alternative and the rationale.

## Out of scope (do not do)
- No backend, Convex schema, Clerk wiring, or real data.
- No other screens (team builder, standings, lineup, onboarding) — duel only this pass.
- Don't wire the design route into the production app navigation.

---

## Note to the operator (you, not the design agent)
The design agent must have **web-search / live-docs research tools enabled** in its
session for Gate 1 to mean anything. If you're running it somewhere without research
access, do the substrate research yourself first and hand the agent the chosen substrate
as a fixed constraint — otherwise Gate 1 collapses back into a training-data default,
which is the exact failure this brief is built to avoid.
