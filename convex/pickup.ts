import { v } from 'convex/values'
import type { Id } from './_generated/dataModel'
import { mutation } from './_generated/server'

/**
 * Start a pickup game between two real MLB teams (SAN-78, ADR-0041). The caller
 * manages both sides; the game is `scheduled` and carries `pickup: true`.
 */
export const createPickupGame = mutation({
  args: { homeTeam: v.string(), awayTeam: v.string() },
  handler: async (_ctx, _args): Promise<Id<'games'>> => {
    throw new Error('not implemented')
  },
})
