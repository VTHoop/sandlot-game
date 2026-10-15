import { v } from 'convex/values'
import type { Doc } from './_generated/dataModel'
import { internalMutation, internalQuery, mutation } from './_generated/server'
import { duelLocks } from './atBat'
import { DuelRole } from './duelContract'
import { authedUser, teamsForHalf } from './participants'
import { PushSeat } from './pushSeat'

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

export const subscribe = mutation({
  args: { endpoint: v.string(), p256dh: v.string(), auth: v.string() },
  handler: async (ctx, { endpoint, p256dh, auth }): Promise<null> => {
    const user = await authedUser(ctx)
    const existing = await ctx.db
      .query('pushSubscriptions')
      .withIndex('by_endpoint', (q) => q.eq('endpoint', endpoint))
      .unique()
    if (existing) await ctx.db.patch(existing._id, { user: user._id, p256dh, auth })
    else await ctx.db.insert('pushSubscriptions', { user: user._id, endpoint, p256dh, auth })
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

function turnPayload(game: Doc<'games'>, home: Doc<'teams'>, away: Doc<'teams'>, seat: PushSeat) {
  const opponent = seat === PushSeat.Home ? away : home
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
  subscriptions: { endpoint: string; p256dh: string; auth: string }[]
}

/**
 * What "your turn" says for one seat of one at-bat, or null when there is nothing
 * to say: the at-bat resolved, the game ended, or this seat has locked. Null is
 * what ends a reminder chain (`pushSend.deliverTurn`), so a stale trigger is a
 * quiet no-op. A seat with no devices still gets an empty list, not null, so its
 * chain keeps its place should the player allow notifications later.
 */
export const turnFor = internalQuery({
  args: {
    game: v.id('games'),
    sequence: v.float64(),
    seat: v.union(v.literal('home'), v.literal('away')),
  },
  handler: async (ctx, args): Promise<TurnPush | null> => {
    const game = await ctx.db.get(args.game)
    if (!game || game.status !== 'live' || game.lastResolvedSequence + 1 !== args.sequence) {
      return null
    }

    // The validator literals equal the enum's values, so the relabel is sound.
    const seat = args.seat as PushSeat
    const [home, away, locks] = await Promise.all([
      ctx.db.get(game.homeTeam),
      ctx.db.get(game.awayTeam),
      duelLocks(ctx, game._id),
    ])
    if (!home || !away) throw new Error(`Game ${game._id} has a club that no longer exists`)

    const club = seat === PushSeat.Home ? home : away
    const role = teamsForHalf(game).battingTeam === club._id ? DuelRole.Batting : DuelRole.Pitching
    const locked = role === DuelRole.Batting ? locks.swingCommitted : locks.pitchCommitted
    if (locked) return null

    const rows = await ctx.db
      .query('pushSubscriptions')
      .withIndex('by_user', (q) => q.eq('user', club.owner))
      .collect()
    return {
      payload: JSON.stringify(turnPayload(game, home, away, seat)),
      subscriptions: rows.map(({ endpoint, p256dh, auth }) => ({ endpoint, p256dh, auth })),
    }
  },
})
