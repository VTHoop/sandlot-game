import type { AppliedAtBat } from '@sandlot/engine/game'
import { v } from 'convex/values'
import type { Doc } from './_generated/dataModel'
import { type MutationCtx, mutation } from './_generated/server'

/**
 * Authoritative game-state mutations (SAN-21). The live `games` row — inning,
 * half, outs, bases, score, whose-turn, status — is advanced ONLY here, never by
 * a client write (game-integrity rule, ADR-0004 / ADR-0017). `startGame` opens a
 * scheduled game; `applyResolvedAtBat` folds each resolved at-bat into the row,
 * called from the secret round-trip's resolution in the SAME transaction as the
 * log append so the two never diverge.
 */

// SAN-21 RED stub — GREEN opens the scheduled game from its lineups.
export const startGame = mutation({
  args: { game: v.id('games') },
  handler: async (_ctx, _args): Promise<void> => {
    throw new Error('not implemented')
  },
})

// SAN-21 RED stub — GREEN folds the at-bat into the authoritative games row.
export async function applyResolvedAtBat(
  _ctx: MutationCtx,
  _game: Doc<'games'>,
  _atBat: AppliedAtBat,
): Promise<void> {}
