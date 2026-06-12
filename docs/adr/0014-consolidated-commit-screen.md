# 14. One commit screen — order-independent blind commits, device keyboard, matchup context

- Status: Accepted
- Date: 2026-06-12

---

## Context

The spike's v1 had separate pitcher and batter screens, a 12-key on-screen NumberPad
consuming ~40% of the viewport, and a one-line situation sentence. Operator review
(2026-06-12) identified that the number entry can use the device keyboard, the freed
space should carry decision-relevant context, and — the substantive rules insight —
**with blind commits, entry order doesn't matter**: sequential-blind and
simultaneous-blind are game-theoretically identical as long as neither number leaks.
"Pitch must be entered first" was inherited fiction, not a fairness requirement.

## Decision

1. **Order-independent commits (product rule).** Either manager may lock first; the
   server resolves when both numbers are present. The only cross-player signal is
   *that* the opponent has locked (boolean) — never the number, never anything
   derived from it. The backend (Convex mutations, future work) must accept commits
   in either order.
2. **One `DuelCommit` screen for both seats.** Identical layout; only the matchup
   orientation and labels flip. A persistent status chip shows the opponent's number
   as `LOCKED` / `NOT YET ENTERED` (static text, no leak surface).
3. **Device keyboard replaces the NumberPad.** `ScoreTileInput`: the scoreboard tile
   as a styled `<input inputMode="numeric">` (no spinners, never browser-default
   looking, per AGENTS.md UI rule). The NumberPad component is removed.
4. **The freed space carries the decision context:**
   - `Scoreboard` (runs/hits/inning/**outs** — outs moved out of the header chrome);
   - compact chalk `FieldDiagram` with base state;
   - `MatchupCard`: current pitcher vs batter as **players** (first initial + last
     name, uniform small type), 1–5 `AttributePips` per attribute — these size the
     odds bands, so they are the most decision-relevant data on the screen — plus
     the next two due-up hitters stacked under a `DUE UP` label. A chalk-dashed
     divider separates pitcher from batter. (Future: basic current-season stat
     lines per player — anticipated, not yet designed.)
   - The situation sentence is removed: the screen *is* the situation.
5. **Opponent presence in the chrome.** Top-right becomes `vs. <opponent>` with a
   green/red presence dot. Presence colors are **scoped tokens**
   (`--color-online` / `--color-offline`), exempt from the four-role color system,
   legal only as small status dots.

## Rejected alternatives

- **Enforced pitch-first flow:** no fairness benefit under blind commits; adds a
  dead waiting state for the batter.
- **Keeping the on-screen NumberPad:** deliberate-feeling, but its real-estate cost
  outweighed the ritual; the OS keyboard is transient and familiar.
- **Keeping the situation sentence:** redundant once scoreboard, presence, field
  state, and matchup are persistent.
