# 31. The game screen is server-driven, not a client loop

- Status: Accepted
- Date: 2026-09-30

## Context

The duel was first playable as a **client-side loop**. `playHalfInning`
(`duelLoop.ts`) asks the pitcher seat for a number, asks the batter seat, hands
both to an adapter's `playAtBat(pitch, swing)`, shows the reveal, and repeats
until the third out. The Convex-backed adapter (SAN-57) kept that shape: it
commits the pitch and then the swing from the one client, and caches a snapshot
the loop reads between at-bats.

That is a hotseat model — one client drives both seats, in order, holding both
numbers — and SAN-57 scoped itself to it explicitly. The question of whether the
real game would wrap that loop or replace it was deferred, first to SAN-22 and
then to SAN-67, on the theory that crossing a half boundary was the first place
the choice would bite.

It bites earlier. Moving the duel into `/game/:id` (SAN-39) requires that a
client drive only the seats whose clubs its viewer owns, and the loop cannot do
that:

- **The client does not hold the other number.** Against the bot or another
  person, one seat's number is never on this client, so there is nothing to pass
  to `playAtBat(pitch, swing)`.
- **Order is not the client's.** Either seat may lock first (ADR-0014), and the
  bot commits the moment an at-bat opens (ADR-0027). The adapter throws when the
  pitch commit resolves the at-bat, because its loop has a swing left over.
- **A reload loses the loop's place.** Where the half started and its running
  totals live in the loop's closure. The acceptance criteria require the screen
  to come from server state alone.
- **Waiting has to end by itself.** A viewer waiting on the other seat must move
  to the reveal when the server resolves, through the subscription. A loop parked
  on a promise has no path for that.

The server, meanwhile, already owns all of it: the locks, the resolution, the
fold into the live row, the half and the inning (ADR-0016, ADR-0017).

## Decision

**`/game/:id` is server-driven.** Which screen shows is a pure function of what
the server reports, plus one fact only the client can know: which reveal this
viewer has already dismissed.

- **Two subscriptions.** `getGame` for the situation, the locks and which clubs
  the viewer owns; `getLastAtBat` for the reveal.
- **Whose turn it is comes from the locks** (`liveDuel.turnFor`): a seat the
  viewer owns that has not locked is theirs to commit; otherwise they are waiting
  on the seat still out. An owner of both clubs is asked for the pitch, then the
  swing. It reads `viewerOwns`, never `viewer` / `viewerSeat`.
- **A commit is one seat through one mutation**, after which the screen waits for
  the subscription. The client never advances itself and never resolves.
- **The reveal is read from the log, by a new query.** `getLastAtBat` returns the
  last resolved at-bat, complete enough to render. `getActiveDuel` cannot serve
  this: its resolved view is replaced as soon as any seat commits to the next
  at-bat, which against the bot is immediately.
- **Loading never replays.** The screen opens with the at-bat already on the
  books marked as seen, so a load or reload lands on the open at-bat. An at-bat
  that resolves afterwards is shown once and dismissed by the viewer.
- **The half summary follows the third out's reveal and stops there.** Carrying
  play into the next half is SAN-67's, which builds on this decision: the next
  half is simply the server's next state.

**`playHalfInning` and `createConvexDuelAdapter` stay, for the showcase.** The
`/design` PLAY tab is a fixture-driven hotseat where one client really does drive
both seats, and the loop is the right shape for it. The route shares the
builders (`buildReveal`, `buildMatchup`) with that path, not the loop.

## Alternatives considered

- **Keep the loop; have the adapter commit only owned seats and wait on the
  subscription for the rest.** The loop's contract is `playAtBat(pitch, swing)`
  with both numbers in hand, so a remote seat needs a second, numberless path
  through every layer. It still loses its place on a reload, which would need a
  separate rebuild-from-server path — at which point two mechanisms decide the
  same screen.
- **Extend `getActiveDuel` to carry the previous resolved at-bat.** One
  subscription instead of two, but it would put a second, unrelated lifetime into
  a query whose job is the at-bat now open, in the module that reads the vault.
  The log is a separate table with a separate rule (rows exist only once
  resolved), and a query over it alone cannot reach an unresolved number.
- **Replay the last at-bat on load.** It would make a reload mid-reveal resume
  the reveal, but every load of a game in progress would open on a play the
  viewer has usually already seen. The criteria ask for the open at-bat.

## Consequences

- One mechanism decides the screen, so a reload, a bot that commits first, the
  hotseat and (later) a second device all land correctly for the same reason.
- The client holds no game state and no number that is not the viewer's own
  before resolution. `LiveGame` subscribes to `getGame` and `getLastAtBat` only;
  a test pins that set.
- A new public query, `atBatView.getLastAtBat`, participant-gated, reading the
  `atBats` log and never `duelCommitments`.
- A viewer who reloads during a reveal does not see that reveal again.
- The final at-bat of a game is not revealed on this screen: the game is `final`
  by the time it would show, and how a final game renders is SAN-67's.
- The half summary is a dead end until SAN-67; the next half is a reload away.
- The Convex adapter's pitch-then-swing assumption is left as it is. Nothing on
  a real route drives it.
- SAN-67 and SAN-22 build on this rather than re-deciding it: sequencing halves
  and resuming across sessions are both "render the server's next state".
