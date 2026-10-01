import { v } from 'convex/values'
import { mutation, query } from './_generated/server'

/**
 * Which reveal each participant has dismissed (SAN-22). Declared and stubbed
 * for the failing tests; implemented in the next commit.
 */

export const getRevealsDismissedThrough = query({
  args: { game: v.string() },
  handler: (): Promise<number | null> => Promise.resolve(null),
})

export const dismissReveal = mutation({
  args: { game: v.id('games'), sequence: v.float64() },
  handler: (): Promise<null> => Promise.resolve(null),
})
