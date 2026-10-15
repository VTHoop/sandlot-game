# 36. Web push turn notifications and reminders: scheduled up front, sent from an action

- Status: Accepted
- Date: 2026-10-15

## Context
ADR-0003 chose web push (VAPID) for the beta's "it's your turn" loop and accepted that iOS subscriptions can die silently. ADR-0014 made either seat free to lock first, so a new at-bat is *both* seats' turn, and ADR-0027 fixed where at-bats open: `game.startGame` and an `atBat.tryResolve` that leaves the game live. SAN-23 builds the push on those two facts. Three constraints shape it:

- **The push must never cost the at-bat.** A mutation cannot call the push service, and a failure there must not roll back a resolution.
- **The payload is secret-adjacent.** It is written next to the vault, so it falls under the secret-pitch rule: no duel number, nothing derived from one, and not whether the opponent has locked.
- **Deadlines are a separate item.** Status is `scheduled | live | final`; a reminder is a nudge, not a timeout.

## Decision
- **One trigger, called where at-bats open.** `pushTrigger.notifySeats` runs beside `bot.scheduleBotSeats` in the same two writes. It only schedules, so the write cannot fail because of a push.
- **Every send for an at-bat is scheduled together, up front.** For each seat it schedules `pushSend.deliverTurn` at once and at 12h, 36h and 60h (the 12h reminder, then every 24h, three at most). Nothing is chained or cancelled. Each run asks `push.turnFor` what to say, which re-reads the game and answers null — a quiet no-op — when the at-bat has resolved, the seat has locked or the game has left `live`. A seat's lock, a resolution and a final each stop its reminders without any of them knowing reminders exist, and one game's schedule shares nothing with another's.
- **Sending is an action.** `pushSend.deliverTurn` (`"use node"`, `web-push`) reads through `turnFor`, sends to every device the recipient has, and deletes a subscription the push service reports gone (404/410). Any other failure is logged and skipped; a deployment without VAPID keys sends nothing.
- **The payload is `{ title, body, url }`, built from public fields only:** the opponent club's name, the inning and half, and the score. The only lock `turnFor` reads is the recipient's own seat's, to stop reminding a seat that has locked, and it never reaches the payload.
- **Subscriptions are rows.** `pushSubscriptions` (user, endpoint, keys), upserted by endpoint through `push.subscribe`. A bot seat never signs in (ADR-0027), so it never holds one.
- **The client asks after the first lock lands**, from inside a game, never on load (`src/push/devicePush.ts`, called from `LiveGame`'s commit). Once the browser says denied, the app does not ask again. Every failure in that path is let go: the player plays exactly as before.
- **A hand-written service worker** (`src/sw.ts`, `injectManifest`) carries the precache `generateSW` produced before plus the `push` and `notificationclick` handlers. What they decide is in `src/push/turnNotification.ts`, as plain tested functions. A notification is tagged by game, so a reminder replaces the push it repeats.
- **Keys.** `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` as Convex env vars; `VITE_VAPID_PUBLIC_KEY` for the client. Unset means no push, not an error.

## Alternatives considered
- **A chain: each reminder schedules the next.** Fewer pending jobs, but a stale link silently breaks the chain's timing, and every link would need its own stop condition. Scheduling all four up front puts the single stop condition in `turnFor`.
- **Cancelling reminders when a seat locks or an at-bat resolves.** Needs to store and look up scheduled-function ids, a second thing to keep in step. A no-op at run time needs nothing stored.
- **Sending from the mutation.** Not possible, and a send that could fail inside the write is the failure the decision above rules out.
- **An in-app notifications toggle, email/SMS fallback, quiet hours.** Out of scope for SAN-23.

## Consequences
- **+** The push cannot fail an at-bat. Reminders stop on lock, resolution or final with no cancellation code. The payload's shape is closed, so a leak needs a new field, which a test pins.
- **−** Up to four pending scheduled jobs per seat per at-bat, most of which are no-ops by the time they run. At a ~6-person beta that is noise; revisit with timeouts (ROADMAP) if volume grows.
- **−** iOS delivery stays as ADR-0003 accepted it: the maintainer guides Add-to-Home-Screen by hand, and dead subscriptions are pruned as they surface.
- The service worker is now source in `src/`, not generated; new worker behavior is added to `src/sw.ts`.
