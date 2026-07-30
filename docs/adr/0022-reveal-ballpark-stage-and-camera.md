# 22. Reveal staged on a ballpark, framed by an outcome-derived camera

- Status: Accepted
- Date: 2026-07-30
- Supersedes (in part): ADR-0013 (reveal composition), ADR-0018/SAN-51 (one shared field)

---

## Context

The reveal's hit animation drew into `FieldDiagram` — a 240×240 diamond that ends at
the basepaths. With no outfield, `HIT_TARGETS` had to place a home run at `y=16` and a
triple at `y=52`, both a bat's length above second base, because there was nowhere else
to put them. Three defects followed, confirmed by the operator: the outcome was
illegible from motion alone, the space read wrong, and the reveal generated no payoff.
Pacing was explicitly *not* a defect at the time.

A spike built three candidate directions against a six-case stress set (HR loaded / 2B
with a runner on first / IF1B / GB force at second / K / BB) — a full fixed-frame park,
a broadcast camera, and an anti-realist telemetry plot. The prototypes live at
`docs/design/reveal-protos.html`.

The engine's own balance harness (SAN-15, gates passing against 2024 MLB) settles what a
fixed frame costs: **37.9% of at-bats send a ball to the outfield, 30.8% keep it in the
infield, and 31.3% never put one in play.** A permanently wide park is therefore the
wrong frame for about 62% of reveals — the diamond shrinks for the majority of at-bats
to make room for an outfield that most of them never use.

## Decision

1. **The reveal gets its own field.** `Ballpark` (foul lines, infield dirt, warning
   track, fence) stages the reveal; `FieldDiagram` continues to serve the commit and
   waiting screens unchanged. This **retires SAN-51's "visually interchangeable"
   rule.** A bare diamond is the wrong stage for a batted ball and a whole park is the
   wrong readout for base occupancy; making them two components makes the divergence
   structural rather than a prop nobody remembers to set. Both still position from
   `fieldMovement.spotPoint`, so there remains one source of geometry.

2. **The camera opens tight and holds what it earned.** It sits on the diamond until
   contact, widens across exactly the flight so it arrives at its widest as the ball
   lands, and then holds through the base running. How far it opens is **derived from
   the landing point**, never from the outcome key — so the frame it rests in is itself
   a readout of how far the ball went, and outcomes nobody framed by hand still frame
   correctly. It never begins closing while the ball is up.

3. **Height rides on the ball's radius.** The park is drawn from overhead, so screen-up
   is center field, not the sky; a parabola reads as a ball flying at the wall. The ball
   swells as it climbs and shrinks as it falls, and the path only bows sideways. This is
   also the only cue separating a fly ball from a grounder before either lands.

4. **Landing marks follow the scorer's convention** — a hit is a dot, an out is an X, a
   home run neither. Shape carries the distinction, not colour, so it survives greyscale
   and does not spend the amber ADR-0012 reserves for consequence.

5. **The beat plays at 1.5×.** Tester feedback after the first pass was that the reveal
   read fast. Every duration and delay passes through one tempo multiplier, so no beat
   can keep its old duration and desynchronise.

6. **One coordinate space.** Chrome, ball and runners all live inside the park's SVG, so
   moving the viewBox moves the contents. Runner tokens moved from positioned HTML —
   which silently depended on the field being exactly 240px wide — to `motion.circle`.

## Deferred

**A distance readout ("412 FT") is explicitly not built.** The telemetry prototype
carried one and it tested well, but **no distance concept exists anywhere in the engine**
— the only "distance" is the duel-number fold of ADR-0016, which is unrelated. Any figure
shown would be invented and would sit next to real numbers on a scoreboard while not
being one. Revisit only alongside a decision about whether the engine should model batted
distance at all; the prototype shows the treatment if it does.

**A reduced-motion design for the camera is deferred.** Motion's `MotionConfig
reducedMotion="user"` still applies, but no bespoke static composition was authored.
Stripping the camera degrades to a fixed wide park, which is coherent but was not
designed — it is what is left over, not what was chosen.

## Rejected alternatives

- **Remove the hit animation.** Cheapest, and it forfeits the moment the whole duel
  builds toward.
- **Fixed wide park, no camera.** What the balance data rules out: the wrong frame for
  ~62% of at-bats, and it discards the framing-as-readout property.
- **Cut instead of pan.** A static per-outcome viewBox gets the correct frame with no new
  motion primitive and no reduced-motion problem. Measurement showed the pan makes the
  ball decelerate ~54% mid-flight — an artifact of the expanding frame, not the physics.
  The operator chose the pan with that measurement in hand; the deceleration is a tuning
  problem (finish widening before the apex) rather than a reason to abandon it.
- **Telemetry / instrument plot.** The most legible of the three and the least like this
  game; it would have needed an amendment to ADR-0012's chalk-diagram direction.
