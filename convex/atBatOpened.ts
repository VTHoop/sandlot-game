import type { Id } from './_generated/dataModel'
import type { MutationCtx } from './_generated/server'
import { scheduleBotSeats } from './bot'
import { notifySeats } from './pushTrigger'

/**
 * Everything that must happen the moment an at-bat opens (ADR-0027, ADR-0036):
 * the bot commits for its seats, and both seats are told it is their turn. The one
 * call `game.startGame` and a resolution in `atBat.tryResolve` make, so a new
 * consequence of an at-bat opening is added here and cannot be missed at one of
 * the two sites.
 */
export async function atBatOpened(ctx: MutationCtx, gameId: Id<'games'>): Promise<void> {
  await scheduleBotSeats(ctx, gameId)
  await notifySeats(ctx, gameId)
}
