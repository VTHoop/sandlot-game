'use node'

import { v } from 'convex/values'
import webpush from 'web-push'
import { internal } from './_generated/api'
import { type ActionCtx, internalAction } from './_generated/server'

/**
 * Hands the turn payload to the push service for each of a player's devices (SAN-23,
 * ADR-0036). An action, not part of any mutation, so nothing here can fail or
 * roll back the at-bat write that scheduled it.
 *
 * A device the push service reports as gone (404/410) is deleted silently —
 * ADR-0003: iOS subscriptions die quietly. Any other failure is logged and
 * skipped; one bad device never stops the rest. A deployment without VAPID keys
 * sends nothing and plays exactly as before.
 */

const GONE = new Set([404, 410])

function statusOf(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null || !('statusCode' in error)) return undefined
  return typeof error.statusCode === 'number' ? error.statusCode : undefined
}

type Subscription = { endpoint: string; p256dh: string; auth: string }

async function sendToDevices(
  ctx: ActionCtx,
  subscriptions: Subscription[],
  payload: string,
): Promise<void> {
  const publicKey = process.env.VAPID_PUBLIC_KEY
  const privateKey = process.env.VAPID_PRIVATE_KEY
  const subject = process.env.VAPID_SUBJECT
  if (!publicKey || !privateKey || !subject) return
  webpush.setVapidDetails(subject, publicKey, privateKey)

  await Promise.all(
    subscriptions.map(async ({ endpoint, p256dh, auth }) => {
      try {
        await webpush.sendNotification({ endpoint, keys: { p256dh, auth } }, payload)
      } catch (error) {
        const status = statusOf(error)
        if (status !== undefined && GONE.has(status)) {
          await ctx.runMutation(internal.push.dropSubscription, { endpoint })
        } else {
          console.error(`Push to a device failed (${status ?? 'no status'})`)
        }
      }
    }),
  )
}

/**
 * "Your turn" for one seat of one at-bat — the push itself, or one of its
 * reminders; they read the same. `push.turnFor` returns null for a stale or
 * already-locked seat, so a reminder that is no longer wanted is a quiet no-op.
 */
export const deliverTurn = internalAction({
  args: {
    game: v.id('games'),
    sequence: v.float64(),
    seat: v.union(v.literal('home'), v.literal('away')),
  },
  handler: async (ctx, args): Promise<null> => {
    const turn = await ctx.runQuery(internal.push.turnFor, {
      game: args.game,
      sequence: args.sequence,
      seat: args.seat,
    })
    if (!turn) return null

    await sendToDevices(ctx, turn.subscriptions, turn.payload)

    return null
  },
})
