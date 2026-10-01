# 34. A reveal is seen once dismissed, and the server keeps that per viewer

- Status: Accepted
- Date: 2026-09-30
- Supersedes (in part): ADR-0031 Decision "Loading never replays", its framing
  "plus one fact only the client can know", and its Consequences "A viewer who
  reloads during a reveal does not see that reveal again" and "`LiveGame`
  subscribes to `getGame` and `getLastAtBat` only"; ADR-0032 Decision "Loading
  still never replays"

## Context

ADR-0031 made `/game/:id` server-driven with one exception: which reveal the
viewer has dismissed was client state. `LiveGame` seeded `dismissed` from the
log on mount, so every load treated the at-bat on the books as already watched
and landed on the open at-bat. ADR-0032 kept that rule for a final game.

That is right for one sitting and wrong across two. Async play (SAN-22) means a
player commits and leaves, and the at-bat resolves while they are away. On
return the seed marks it watched, and the reveal of their own at-bat is never
shown. The same happens when the app is closed partway through a reveal. A
player using a second device has no way to say what the first one showed.

ADR-0031 rejected "replay the last at-bat on load" because "every load … would
open on a play the viewer has usually already seen". That objection holds
against a replay keyed on nothing. It does not hold against a replay keyed on
whether this viewer dismissed it.

## Decision

**A reveal counts as seen once the viewer dismisses it, and the server records
that per (game, user).**

- **`revealDismissals`** holds one row per (game, user): `dismissedThrough`, the
  sequence of the last at-bat whose reveal the user dismissed. It is a
  high-water mark, read with `.unique()` on `by_game_user`.
- **`dismissReveal({ game, sequence })`** is the only writer. It checks auth,
  then participation, then that `sequence` has resolved (`≤ lastResolvedSequence`).
  A missing game and a game the caller has no club in get the same refusal. It
  only raises the mark, so a late or repeated call cannot bring a reveal back.
  There is no status check, because a final game's deciding play is dismissed
  after the game goes final.
- **`getRevealsDismissedThrough({ game })`** reads it: a sequence, or `null` for
  none, and the same `null` for every refusal (ADR-0025).
- **The client** subscribes to it as a third query and waits for it as it waits
  for the other two. `dismissed` is the larger of the server's value and what
  this screen has just dismissed, worked out on every render, not seeded once.
  A dismissal on another device therefore moves an open screen on, and a local
  dismissal moves the screen on without the round trip.
- **The advance control** calls `dismissReveal` with the at-bat its reveal
  showed (ADR-0031's pinned at-bat), never the latest. A failure is let go
  without a notice; the cost is one replay on the next load.

Screen order is ADR-0032's, unchanged. On return, an undismissed third out
reveals and then shows the half card; an undismissed deciding play reveals,
then FINAL SCORE →, then game-over.

## Alternatives considered

- **A field on `games`.** One fewer table, but `getGame` reads that row and
  scans the log, so every dismissal would wake both participants'
  subscriptions. It would also conflict, under OCC, with every resolution
  writing the same row.
- **A viewer-relative field on `getLastAtBat`.** One subscription fewer, but
  that read model gives both participants the same answer (ADR-0025,
  ADR-0030). Splitting it per viewer would break the property its tests pin.
- **Keyed per seat or club, not per user.** An owner of both clubs would hold
  two marks for one screen.
- **Local storage.** It survives a reload, but not a second device.
- **A Convex optimistic update in place of local state.** One source of truth,
  but the local high-water mark is two lines and keeps the test fakes plain.

## Consequences

- `LiveGame` subscribes to three queries. The pinned-set test names them all.
  The third returns `number | null`, so it cannot carry a duel number.
- `dismissReveal` is the first mutation a client sends that is not a commit or
  a start. It writes presentation state, not game state: resolution never reads
  it.
- A reload partway through a reveal shows that reveal again. A reload after
  dismissing it lands where ADR-0031 and ADR-0032 already land.
- The half card is still client state (ADR-0032). Dismissal is recorded when the
  reveal advances, before the card, so a reload while the card is up lands on
  the next at-bat and a second device never shows the card.
- `sideChangeOf` reads the half the server has open now. On return that is the
  half after the missed at-bat only because a player is at most one at-bat
  behind: nothing resolves without the viewer's own commit (`atBat.ts` accepts
  a commit only into the open at-bat).
- Games already under way when this ships have no row, so their last resolved
  at-bat reveals once on the next load. That is accepted.
