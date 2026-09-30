# 30. The duel's view-models are absolute: no "you" and "them"

- Status: Accepted
- Date: 2026-09-30

## Context

The reveal, commit and waiting screens were built on a view-model that described
an at-bat *for the batter*: `RevealScenario` carried `you` / `them` (the swing
and the pitch), `opponent` (the pitcher faced), and `scoreBefore` / `hitsBefore`
as `{ you, opp }`. The adapter translated the engine's absolute state into that
shape off the batting side, and swapped the hit totals whenever a half ended.

That was correct for what it was built for — one hotseat half-inning, where the
person at the screen plays both seats and the at-bat is the batter's moment
(SAN-45). `adapter.ts`'s header said so, and named the fix for when a real viewer
arrived: add a `viewer` input and key the perspective-bearing spots off it, with
"the `RevealScenario` shape unchanged".

Moving the duel into `/game/:id` (SAN-39) is where a real viewer arrives, and the
planned fix did not survive contact with it:

- **The shape had to change anyway.** The reveal credits the play's runs and hit
  to the "you" scoreboard row, and `deriveDrama` adds the runs to "your" score.
  For a viewer who is pitching, the runs are the other club's — so the scenario
  would have needed a new field saying which side batted, on top of the flip.
- **The copy doubled.** "You strike out" is wrong from the mound. A viewer input
  meant a second scoreline table and a second set of callouts.
- **Hotseat has no "you".** One account can own both clubs (ADR-0028). That
  viewer is both sides of every at-bat, and a view-model that must pick one is
  wrong for them by construction.

Meanwhile the server never had this problem: `getGame` is absolute — home and
away — for every participant (ADR-0025). The perspective was something the
client added on the way to the screen.

## Decision

**The duel's view-models describe an at-bat by what happened, not by who is
looking.**

- `RevealScenario` carries `pitch` / `swing`, `pitcher` / `batter` (names),
  `clubs` (scoreboard labels), and `scoreBefore` / `hitsBefore` keyed
  `away` / `home`. `half` says which club batted (top = away, SAN-21).
  `DuelSituation` is the same subset as before, minus the two numbers.
- `DuelMatchup` is one matchup — `{ pitcher, batter, dueUp }` — not a "you" side
  and an "opponent" side.
- The scoreline names the batter in the third person ("R. VANCE strikes out").
- The scoreboard is away then home, by club label, and a run goes to the club
  that batted.
- The lock chip and the waiting screen name the other seat's player and what
  they owe ("M. SLOANE's pitch").
- The chrome names the matchup ("HAR @ RID") rather than an opponent, and drops
  the presence dot: there is no presence data behind it.
- Drama is judged from the batting club — the one that can score on the play —
  and names it by label ("LEAD CHANGE — RID LEADS 5–4"). That is a fact about the
  at-bat, the same for everyone, not a viewer's perspective.

**No viewer input is threaded through the adapter.** A screen that wants to mark
what is the viewer's — a highlight, a "your turn" — does it from `getGame`'s
`viewerOwns`, on top of these shapes.

**Club labels are the first three letters of the club's name** (`clubLabel`),
as a stand-in. Clubs carry no abbreviation yet; SAN-68 owns real club labels.

**Drama's inning thresholds read the engine's `REGULATION_INNINGS`.** They were
hard-coded for nine innings (walk-off from the 9th, "late" from the 7th) while
the engine plays six, so a real game could not produce a walk-off callout. A
walk-off is now the bottom of the last regulation inning or later, and "late" is
the last two regulation innings.

## Alternatives considered

- **Add the `viewer` input, as planned.** Rejected for the reasons in Context: it
  needed a shape change regardless, doubled the copy, and still had no answer for
  an owner of both clubs. It also built further on a translation that the
  hotseat-presentation work (SAN-68) would then have to unpick.
- **Keep "you"/"them" and pick a side for a two-club owner.** Any rule (home
  wins, batting wins) is arbitrary and shows half the at-bats from the wrong side.
- **Absolute data, viewer-relative copy** ("you strike out" only when the viewer
  owns the batting club). Two voices on one screen for different viewers, for a
  line that is clearer naming the player. A "yours" highlight can be added later
  without changing the model.

## Consequences

- One scenario is correct for the batting club, the pitching club, and an owner
  of both. The `/game/:id` screen (SAN-39) needs no perspective logic, and SAN-68
  becomes a change of labels rather than of model.
- The adapter's `byBattingSide` split and the fixture path's `rollHitTotals` swap
  are gone. Totals pass through as the server sends them, so a half boundary can
  no longer flip one total and not another.
- `DuelAdapter` gains `clubs()`, and `resolveDuelAtBat` / `deriveSituation` take a
  `Board` (club labels + hits) — what the scoreboard knows and the engine's live
  state does not.
- The batter loses the second-person copy ("you go yard"). Nothing on these
  screens addresses the viewer now, except the entry field ("your number"),
  which is about whoever is typing.
- Two clubs whose names share their first three letters read alike on the
  scoreboard until SAN-68.
- Supersedes the PERSPECTIVE note in `adapter.ts` and `docs/ABSTRACTIONS.md`. It
  does not supersede ADR-0025: the read model was already absolute, and its
  per-caller fields (`viewer`, `viewerOwns`, `viewerSeat`) are unchanged.
