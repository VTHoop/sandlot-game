import { v } from 'convex/values'
import { mutation } from './_generated/server'

/**
 * Web push and turn reminders (SAN-23, ADR-0003). Red checkpoint: the seam the
 * tests are written against, with no behavior behind it yet.
 */
export const subscribe = mutation({
  args: { endpoint: v.string(), p256dh: v.string(), auth: v.string() },
  handler: async (): Promise<null> => {
    throw new Error('push.subscribe is not implemented')
  },
})
