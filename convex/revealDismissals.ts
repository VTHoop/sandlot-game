import { v } from 'convex/values'
import type { Doc, Id } from './_generated/dataModel'
import { mutation, query } from './_generated/server'
import { ownershipOf } from './gameView'
import { authedUser, type Ctx, maybeUser } from './participants'

/**
 * Which reveal each participant has dismissed (SAN-22, ADR-0034).
 *
 * A reveal is seen once the viewer dismisses it, and that fact lives here rather
 * than in the client, so a reveal interrupted by closing the app is waiting on
 * return — on any device, since the record is the user's, not the session's.
 *
 * PER VIEWER, UNLIKE THE READ MODELS BESIDE IT. `getGame` and `getLastAtBat` give
 * both participants the same answer (ADR-0025, ADR-0030); this one does not,
 * which is why it is its own module and its own subscription.
 *
 * NOT GAME STATE. Resolution never reads it, and it holds an at-bat's sequence,
 * never a duel number — a sequence is only ever one the log already shows.
 */

/** One refusal for a game that is not there and a game the caller has no club
 * in, so the mutation cannot say which games exist (ADR-0025). */
const NOT_A_PARTICIPANT = 'Not a participant in this game'

/** The game, if `user` owns either of its clubs; otherwise null, whether or not
 * the game exists. */
async function participantGame(
  ctx: Ctx,
  id: Id<'games'>,
  user: Doc<'users'>,
): Promise<Doc<'games'> | null> {
  const game = await ctx.db.get(id)
  if (!game) return null
  const owns = await ownershipOf(ctx, game, user)
  return owns.home || owns.away ? game : null
}

/** The user's dismissal row for a game. `.unique()` throws on a duplicate rather
 * than picking one, so a second row is a loud failure, not a silent replay. */
function dismissalOf(
  ctx: Ctx,
  game: Id<'games'>,
  user: Id<'users'>,
): Promise<Doc<'revealDismissals'> | null> {
  return ctx.db
    .query('revealDismissals')
    .withIndex('by_game_user', (q) => q.eq('game', game).eq('user', user))
    .unique()
}

/**
 * The sequence of the last at-bat whose reveal the caller has dismissed in this
 * game, or `null` when they have dismissed none.
 *
 * `null` also covers a caller who owns neither club, no caller, and an id that
 * names no game — the same single refusal as `getGame` and `getLastAtBat`.
 */
export const getRevealsDismissedThrough = query({
  args: { game: v.string() },
  handler: async (ctx, args): Promise<number | null> => {
    const id = ctx.db.normalizeId('games', args.game)
    if (!id) return null
    const user = await maybeUser(ctx)
    if (!user) return null
    const game = await participantGame(ctx, id, user)
    if (!game) return null
    // No row is a viewer who has dismissed nothing yet, not an inconsistency.
    const dismissal = await dismissalOf(ctx, game._id, user._id)
    return dismissal ? dismissal.dismissedThrough : null
  },
})

/**
 * Record that the caller has dismissed the reveal of at-bat `sequence`.
 *
 * A high-water mark: an earlier sequence than the one on file changes nothing,
 * so a late or repeated call can never bring a dismissed reveal back. A sequence
 * the game has not resolved is refused rather than clamped — a client only
 * reveals an at-bat it read from the log, so one it has not is a bug.
 *
 * There is no status check: the deciding play of a final game is revealed, and
 * dismissed, after the game has gone final (ADR-0032).
 *
 * Two dismissals racing for the same row are safe without a lock: both read the
 * `by_game_user` range they write into, so the loser conflicts and retries
 * against the winner's row (AGENTS.md, "Concurrency by OCC").
 */
export const dismissReveal = mutation({
  args: { game: v.id('games'), sequence: v.float64() },
  handler: async (ctx, args): Promise<null> => {
    const user = await authedUser(ctx)
    const game = await participantGame(ctx, args.game, user)
    if (!game) throw new Error(NOT_A_PARTICIPANT)
    const { sequence } = args
    if (!Number.isInteger(sequence) || sequence < 0 || sequence > game.lastResolvedSequence) {
      throw new Error(`No resolved at-bat ${sequence} in this game`)
    }

    const dismissal = await dismissalOf(ctx, game._id, user._id)
    if (!dismissal) {
      await ctx.db.insert('revealDismissals', {
        game: game._id,
        user: user._id,
        dismissedThrough: sequence,
      })
    } else if (sequence > dismissal.dismissedThrough) {
      await ctx.db.patch(dismissal._id, { dismissedThrough: sequence })
    }
    return null
  },
})
