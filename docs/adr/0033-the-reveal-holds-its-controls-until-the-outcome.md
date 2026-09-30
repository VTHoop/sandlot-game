# 33. The reveal holds the outs and its controls until the outcome lands

- Status: Accepted
- Date: 2026-09-30
- Supersedes (in part): ADR-0013 Decision 5, "production reveals must be tap-skippable"

## Context

The reveal's scoreboard waits for the play before it counts the play. The hit
flips when the outcome lands and the run flips when the runner crosses home
(ADR-0013 Decision 3). The out count did not wait. It showed the post-play
count from the first frame, so a strikeout could be read off the pips before
the flaps had turned. NEXT BATTER → and ↺ REPLAY were also up from the first
frame, so a player could leave a reveal before seeing its result.

ADR-0013 required production reveals to be tap-skippable. With no skip
gesture built, the advance control was the only way to skip.

## Decision

- **The out is counted when the hit is.** The scoreboard shows the outs as
  they stood before the play (`RevealScenario.outsBefore`) until the hit tick
  (`hitTickAt`, a beat after the outcome word settles), then the outs after it.
  That makes one "result revealed" moment for hits and outs. Runs keep their
  own tick at home.
- **The advance control and REPLAY mount when the outcome lands.** Before
  that, neither is in the DOM, so neither can be tabbed to.
- **The build-up before the outcome is not skippable.** The flaps and the held
  breath are part of the drama, and they last a few seconds. Everything after
  the outcome can still be skipped with the advance control. This replaces
  ADR-0013's "must be tap-skippable" for production reveals. The rest of
  ADR-0013 Decision 5 stands.
- **Reduced motion is unchanged in kind.** It re-anchors every beat on the
  outcome (`compressToOutcome`), so the outs and both controls appear at once.
- **REPLAY restarts from the pre-play board.** Callers already remount the
  reveal on REPLAY, so the outs, like the runs and hits, go back to their
  pre-play values and count again.

## Alternatives considered

- **Show the controls at the scoreline, after the runs.** This would make
  every part of the play unskippable, including the runner animation, which
  can run long on a big hit.
- **Keep the controls up and add a tap-to-skip.** This would keep ADR-0013's
  rule, but a skip that jumps to the result shows the same thing the early
  controls did. Nothing asked for it.
- **Derive the pre-play outs from the retired movements.** That works only for
  as long as every out is traced as a movement. An explicit field cannot drift.

## Consequences

- `RevealScenario` carries `outsBefore` beside `outs`. Every builder
  (`buildReveal`, the fixtures) fills it from the state before the play.
- `design-principles.md` §4 and §5b.6 are updated to match.
