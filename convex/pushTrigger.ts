import { internal } from './_generated/api'
import type { Id } from './_generated/dataModel'
import type { MutationCtx } from './_generated/server'
import { PushSeat } from './pushSeat'

/**
 * The one call a write makes when it opens an at-bat (SAN-23, ADR-0003):
 * `game.startGame`, and a resolution in `atBat.tryResolve` that leaves the game
 * live — the same two places that call `bot.scheduleBotSeats` (ADR-0027). It only
 * schedules, so the push can never fail or roll back the write that triggered it;
 * everything that reads state or talks to the push service runs later, in
 * `pushSend.deliverTurn`.
 *
 * Kept apart from `push.ts` so `atBat.ts` and `game.ts` can call it without
 * importing a module that itself imports `atBat.duelLocks`.
 */
const HOUR_MS = 3_600_000

/**
 * When, after an at-bat opens, a seat is told: at once, then a reminder at 12h
 * and every 24h after, three at most. All are scheduled together, up front — each
 * re-checks the game when it runs, so a seat that has locked, an at-bat that has
 * resolved or a game that has ended turns the rest into no-ops. Nothing is ever
 * cancelled, and one game's schedule shares nothing with another's.
 */
const NOTIFY_AFTER_MS = [0, 12 * HOUR_MS, 36 * HOUR_MS, 60 * HOUR_MS]

export async function notifySeats(ctx: MutationCtx, gameId: Id<'games'>): Promise<void> {
  const game = await ctx.db.get(gameId)
  // Every caller has just written this row, so a missing one is a fault.
  if (!game) throw new Error(`Cannot notify the seats of game ${gameId}: it does not exist`)
  if (game.status !== 'live') return

  const sequence = game.lastResolvedSequence + 1
  for (const seat of [PushSeat.Home, PushSeat.Away]) {
    for (const delay of NOTIFY_AFTER_MS) {
      await ctx.scheduler.runAfter(delay, internal.pushSend.deliverTurn, {
        game: gameId,
        sequence,
        seat,
      })
    }
  }
}
