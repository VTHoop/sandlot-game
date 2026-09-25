# 27. The server-side bot opponent: seed-held seats, committed when the at-bat opens

- Status: Accepted
- Date: 2026-09-25

## Context

The bot seat agent (SAN-48) lives in the browser, inside the hotseat loop. Over
the network that is not an opponent: it cannot commit while its client is
closed, and a client-supplied "bot" number is a client writing game state, which
the integrity rule forbids. SAN-58 moves the bot onto the server so one
signed-in human can play a game to the final out alone.

Three things had to be decided:

**1. Which seats the bot plays.** Nothing on a `teams` or `games` row says "bot".

**2. What makes the bot commit.** Convex has no triggers; something must run
the bot's commit, in a transaction of its own, without the human's client.

**3. Where the number-selection policy lives.** The client bot's uniform draw sat
in `src/design/duel/`, which nothing in `convex/` imports.

## Decision

**A seat is the bot's exactly when its club is held by the dev seed owner**
(`SEED_CLERK_SUBJECT`), and only where `SANDLOT_DEV_SEED` is enabled
(`seed.isSeedEnabled`, shared with the seed's own fence). Seed clubs exist for
test games only, so the bot is a test opponent, not a product feature, and it
needs no column: `bot.isBotSeat` computes it from ownership. Handing a club to a
human (`seed.assignClubToUser`) takes it from the bot; handing it back to the
seed owner's subject returns it. Test play is human vs. human or human vs. bot,
never both at once, so the seed's two clubs suffice.

**The bot commits the moment an at-bat opens.** Either side may lock first
(ADR-0014), so the bot never waits for the human. Every write that opens an
at-bat — `game.startGame`, and a resolution in `atBat.tryResolve` that leaves the
game live — calls `bot.scheduleBotSeats` in the same transaction, which
schedules `atBat.commitBotSeat` via `ctx.scheduler.runAfter(0, …)` for each seat
the bot holds. The scheduler is what lets the bot play with the human's client
closed. SAN-22's waiting flow consumes only the lock state; it does not own this
trigger.

**`commitBotSeat` lives in `atBat.ts`**, so `duelCommitments` keeps exactly one
reader. It shares `seal` with the human commit — range check, seated player, one
commitment per role per at-bat, resolve if the opponent is on file — and differs
only in who is let in: the human path authenticates and checks club ownership
(identity → club → status, ADR-0026); the bot path checks the seat is still the
bot's. The bot never declares a bunt.

**A stale trigger is a quiet no-op; anything else throws.** The game ended, the
at-bat already resolved, or the seat is already on file: each is an expected
late or duplicate trigger. A seat the bot no longer holds, a game that does not
exist, or an at-bat that has not opened yet is a fault, and fails the scheduled
function loudly rather than being retried or defaulted past.

**One policy, in the engine: `@sandlot/engine/bot` `pickBotNumber(rng)`.** The
client bot and `commitBotSeat` both call it. It takes a draw and nothing else,
so no part of the game — least of all the opponent's number — can reach the
pick: the secret-state law holds for the bot by its signature. SAN-48's
rationale moves with it: in a blind duel the expected outcome is identical
across picks, so uniform-random is the equilibrium baseline.

## Alternatives considered

**An explicit controller on the game or seat.** Rejected for now: it writes a
test-only concept into production entities, and adds a second source of truth
beside ownership (a seat marked "human" on a club the seed owner holds could
never be committed). Revisit if a bot becomes a product feature.

**Commit in reaction to the human's commit.** Rejected: it makes the human
always go first, ties the bot to the lock signal SAN-22 also consumes, and buys
nothing — ADR-0014 already lets either side lock first.

**Route the bot through `commitPitch` / `commitSwing`.** Rejected: both
authenticate first (ADR-0026), and a scheduled function has no identity. Faking
one would break the identity-first ordering the rejection taxonomy rests on.

**A guard-locked mirror of the policy in `convex/`.** Rejected: a compile-time
guard can lock two value domains together, not two random functions, so a
mirror is a second copy kept in step by memory.

## Consequences

- `convex/atBat.ts` and `convex/game.ts` now reach the dev seed's constant
  through `convex/bot.ts`. That is reading who the seed owner is, not handing
  out seed clubs (SAN-65 narrows its own rule to the latter).
- Re-pointing a club while one of its games is live changes who plays that seat
  mid-game. The dev-only assignment does not block it; finish or abandon the
  game first.
- Bot-vs-bot is out of scope. It is also unreachable today: only a signed-in
  owner can start a game, and the seed owner cannot sign in. It is the seed of
  the future balance simulator against the real backend.
