import { type Infer, v } from 'convex/values'
import type { Doc } from './_generated/dataModel'
import { internalMutation, internalQuery, mutation } from './_generated/server'
import { duelLocks } from './atBat'
import { ClubSide } from './clubSide'
import { authedUser, sideLocked } from './participants'
import { clubSide, pushDevice } from './validators'

/**
 * Web push and turn reminders (SAN-23, ADR-0003, ADR-0036).
 *
 * `pushTrigger.notifySeats` schedules `pushSend.deliverTurn` for both seats of
 * every at-bat that opens. Each run asks {@link turnFor} what to say, which
 * re-reads the game, so a late trigger — the at-bat resolved, the seat locked,
 * the game ended — is a quiet no-op. Sending happens in an action, so a push that
 * fails can never touch the at-bat write.
 *
 * **Secrecy.** The payload is built from the club names, the inning and the
 * score — public fields — and nothing else, so neither duel number and not the
 * opponent's lock state can reach it. The only lock this module reads is the
 * recipient's own seat's, to stop reminding a seat that has already locked.
 */

/** Hosts a browser hands out push endpoints on: Chrome and Edge's FCM, Firefox's
 * autopush, Safari's web push and Windows' WNS. */
const PUSH_HOSTS = new Set(['fcm.googleapis.com', 'updates.push.services.mozilla.com'])
const PUSH_HOST_SUFFIXES = ['.push.apple.com', '.notify.windows.com']

/** Whether a host is one a push service hands endpoints out on. */
function isPushHost(hostname: string): boolean {
  return PUSH_HOSTS.has(hostname) || PUSH_HOST_SUFFIXES.some((s) => hostname.endsWith(s))
}

/** Plain https on the default port, with no credentials in the address. */
function isPlainHttps(url: URL): boolean {
  return url.protocol === 'https:' && url.port === '' && !url.username && !url.password
}

/**
 * Whether an endpoint is a push service's. `pushSend` posts to whatever is stored
 * here, signed with the server's VAPID key, so an endpoint a caller chose freely
 * would be a request the server makes for them (CWE-918).
 */
function isPushServiceEndpoint(endpoint: string): boolean {
  if (!URL.canParse(endpoint)) return false
  const url = new URL(endpoint)
  return isPlainHttps(url) && isPushHost(url.hostname)
}

export const subscribe = mutation({
  args: pushDevice.fields,
  handler: async (ctx, { endpoint, p256dh, auth }): Promise<null> => {
    const user = await authedUser(ctx)
    if (!isPushServiceEndpoint(endpoint)) throw new Error('That endpoint is not a push service')
    const existing = await ctx.db
      .query('pushSubscriptions')
      .withIndex('by_endpoint', (q) => q.eq('endpoint', endpoint))
      .unique()
    if (!existing) {
      await ctx.db.insert('pushSubscriptions', { user: user._id, endpoint, p256dh, auth })
    } else if (existing.user !== user._id || existing.p256dh !== p256dh || existing.auth !== auth) {
      // A device goes to whoever registered it last; an unchanged one is not rewritten.
      await ctx.db.patch(existing._id, { user: user._id, p256dh, auth })
    }
    return null
  },
})

/** A push service reported the subscription gone (404/410): forget it, silently. */
export const dropSubscription = internalMutation({
  args: { endpoint: v.string() },
  handler: async (ctx, { endpoint }): Promise<null> => {
    const rows = await ctx.db
      .query('pushSubscriptions')
      .withIndex('by_endpoint', (q) => q.eq('endpoint', endpoint))
      .collect()
    for (const row of rows) await ctx.db.delete(row._id)
    return null
  },
})

interface TurnPayload {
  title: string
  body: string
  url: string
}

function turnPayload(game: Doc<'games'>, home: Doc<'teams'>, away: Doc<'teams'>, seat: ClubSide) {
  const opponent = seat === ClubSide.Home ? away : home
  const payload: TurnPayload = {
    title: `Your turn vs ${opponent.name}`,
    body: `${game.half === 'top' ? 'Top' : 'Bottom'} ${game.inning} · ${away.name} ${game.awayScore}, ${home.name} ${game.homeScore}`,
    url: `/game/${game._id}`,
  }
  return payload
}

/** What to send one seat of one at-bat, and to which devices. */
export interface TurnPush {
  payload: string
  subscriptions: Infer<typeof pushDevice>[]
}

/** Whether `sequence` is the at-bat open on a live game: the only one a push is for. */
function isOpenAtBat(game: Doc<'games'> | null, sequence: number): game is Doc<'games'> {
  return game?.status === 'live' && game.lastResolvedSequence + 1 === sequence
}

/**
 * What "your turn" says for one seat of one at-bat, or null when there is nothing
 * to say: the at-bat resolved, the game ended, or this seat has locked. Null is
 * what turns a reminder into a quiet no-op (`pushSend.deliverTurn`). A seat with
 * no devices still gets an empty list, not null, so a player who allows
 * notifications later is reached by the reminders still to come.
 */
export const turnFor = internalQuery({
  args: { game: v.id('games'), sequence: v.float64(), seat: clubSide },
  handler: async (ctx, args): Promise<TurnPush | null> => {
    const game = await ctx.db.get(args.game)
    if (!isOpenAtBat(game, args.sequence)) return null

    // The validator literals equal the enum's values (guarded in ./validators).
    const seat = args.seat as ClubSide
    const [home, away, locks] = await Promise.all([
      ctx.db.get(game.homeTeam),
      ctx.db.get(game.awayTeam),
      duelLocks(ctx, game._id),
    ])
    if (!home || !away) throw new Error(`Game ${game._id} has a club that no longer exists`)
    if (sideLocked(game, locks, seat)) return null

    const rows = await ctx.db
      .query('pushSubscriptions')
      .withIndex('by_user', (q) => q.eq('user', (seat === ClubSide.Home ? home : away).owner))
      .collect()
    return {
      payload: JSON.stringify(turnPayload(game, home, away, seat)),
      subscriptions: rows.map(({ endpoint, p256dh, auth }) => ({ endpoint, p256dh, auth })),
    }
  },
})
