# 32. The duel screen spans half boundaries and the final

- Status: Accepted
- Date: 2026-09-30
- Builds on: ADR-0031 (does not supersede it)

## Context

ADR-0031 made `/game/:id` server-driven and left two things to SAN-67:

- "The half summary is a dead end until SAN-67; the next half is a reload away."
- "The final at-bat of a game is not revealed on this screen: the game is
  `final` by the time it would show, and how a final game renders is SAN-67's."

The first is small: there is no between-halves server state. The fold that
records the third out also opens the next half (ADR-0017), so the summary is
presentation over a state the server has already moved past.

The second is the real problem. The at-bat that ends a game and the `final`
status arrive in the same transaction. `GameScreen` chose its screen by status,
so the moment the game went final it unmounted the duel and, with it,
`dismissed`, the only record that this viewer had not yet watched that at-bat.
A remounted screen seeds `dismissed` from the log, as a reload does, so the
deciding play would never be shown. SAN-67's criteria require the reveal, then
the game-over screen.

## Decision

**Live and final render the same element in the same place.** `GameScreen`
sends both statuses to the code-split `LiveGame`, which now takes a
`PlayedGameView` (live or final). React keeps the instance when the status
changes under it, so `dismissed` survives, and the game-ending at-bat is still
unseen:

- Screen order: half summary (live only) → an undismissed reveal → game-over
  (final) → the open at-bat.
- **The game-ending at-bat is the latest at-bat of a final game.** Its reveal
  advances with FINAL SCORE →. The half flag cannot identify it: a walk-off
  ends no half by outs, so `endedHalf` is false.
- **No half card after the last half.** A reveal that ended a half queues the
  summary only while the game is live.
- **Loading still never replays.** A reload of a final game seeds `dismissed`
  from the log and lands on game-over. This is ADR-0031's rule, unchanged.

**Between halves, the card waits for the player.** It shows the half's totals
and the side change, which is read from the server's live state (the half now
open and the club batting in it), never counted forward. It stays until
CONTINUE is tapped, and CONTINUE takes focus on arrival. A reload between
halves lands on the next at-bat, not the card, because there is no server
state to restore it from.

**The line score is the read model's.** `getGame`'s final variant carries
`lineScore`, folded from the at-bat log on the same read as the hit totals. A
bottom half with no rows is `null` ("X"). A top half with no rows cannot
happen in play, so the read refuses the log instead of drawing it.

## Alternatives considered

- **Remember "saw it live" in `GameScreen` and replay the last at-bat for a
  final game only then.** This needs a second piece of client state and a
  second rule deciding the same screen that `dismissed` already decides.
- **Replay the last at-bat on any load of a final game.** Every visit to a
  finished game would open on a play the viewer has usually already seen. The
  criteria ask for game-over.
- **Show game-over at once and leave the deciding play unshown.** Rejected by
  the criteria. The last play is the one players most want to see.
- **Derive the line score on the client from the at-bat log.** The client does
  not read the log. `getLastAtBat` names one row, and widening a client read to
  the whole log to draw a table is the wrong trade.

## Consequences

- One mechanism still decides the screen. The final is one more state that
  mechanism renders, not a separate route.
- The motion chunk loads for a final game even when there is nothing to
  reveal. This is acceptable, because it is the chunk the game has been using
  the whole time.
- A final fixture must carry a coherent log: one that skips an inning makes
  `getGame` throw. The adapter's walk-off fixture was fixed to match.
- ADR-0031's two "until SAN-67" consequences are resolved here. Its other
  consequences stand.
