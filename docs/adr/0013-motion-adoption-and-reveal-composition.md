# 13. Reveal choreography — adopt Motion; scoreboard as consequence echo

- Status: Accepted
- Date: 2026-06-12

---

## Context

ADR-0012 set a CSS-first motion policy with a sanctioned escalation: adopt the Motion
library "only when state-driven choreography exceeds clean CSS." A v1 CSS-only reveal
proved the sequence; an A/B comparison against a Motion-built variant was run in the
parked `/design` showcase. The operator's verdict: the spring physics were subtle, but
**drama-scaled pacing visibly improves the beat** — and should extend beyond outcome
quality to game situations (lead change, RBI, late-and-close). The operator also judged
the outcome ladder low-value on the reveal screen and asked for an animated scoreboard
in its place, while flagging the standing risk: "eye-catching but not busy."

## Decision

1. **Adopt `motion` (v12) for reveal choreography** per ADR-0012's escalation clause.
   The CSS v1 reveal and the A/B toggle are removed; one reveal implementation
   (`src/design/duel/RevealMotion.tsx`) is the source of truth. Motion is imported
   only by the code-split design route today; the production shell is unaffected.
2. **Situational drama model** (`src/design/duel/scenario.ts`): the reveal's held
   breath = outcome base hold + leverage boosts (walk-off > lead change > new tie >
   RBI; late-and-close adds pacing without a callout), capped so stacked drama never
   drags. The headline (e.g. "LEAD CHANGE — YOU LEAD 5–4") is stamped as a clay chip
   under the outcome. Pure function, unit-tested.
3. **Reveal composition change:** the outcome ladder moves off the reveal — it remains
   on the decision seats (pitcher/batter), where it informs the bet. Its slot is taken
   by the **`Scoreboard`** foundation component, which ticks as consequence lands:
   the hit count flips when the outcome lands, the run flips when the runner crosses
   home (split-flap remount, amber→chalk).
4. **Hit location in diagram language:** hits draw a dashed chalk tracer to a
   jittered, outcome-appropriate landing point marked with a scorekeeper's ✕ — a
   spray-chart mark, not an illustration.
5. **The busy-ness budget** (binding, recorded in `design-principles.md`): one new
   element per beat; at most two elements animating simultaneously; amber remains
   singular; ambience (fireflies) only on calm screens (waiting); production reveals
   must be tap-skippable.

## Rejected alternatives

- **Keeping both reveal engines:** every reveal feature would need dual
  implementation; the comparison already served its purpose.
- **Full-field illustration / rendered field art:** permanently rejected
  (diagram-not-illustration law, ADR-0012) — this is the "too far" line.
- **Ambient night effects on action screens:** rejected; ambience lives only where
  nothing is happening.
