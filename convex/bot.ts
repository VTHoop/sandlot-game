import type { Infer } from 'convex/values'
import { internal } from './_generated/api'
import type { Id } from './_generated/dataModel'
import type { MutationCtx } from './_generated/server'
import { type Ctx, teamsForHalf, userBySubject } from './participants'
import { isSeedEnabled, SEED_CLERK_SUBJECT } from './seed'
import type { duelRole } from './validators'

/**
 * The server-side bot opponent (SAN-58, ADR-0027) — who the bot is, and when it
 * is asked to play. The commit itself lives in `atBat.commitBotSeat`, so
 * `duelCommitments` keeps exactly one reader.
 *
 * **A seat is the bot's exactly when its club is held by the dev seed owner**, and
 * only where the dev seed is enabled. Seed clubs exist for test games only, so the
 * bot is a test opponent, not a product feature: no column marks it and nothing
 * outside the fixture's own flag turns it on.
 *
 * **The bot commits the moment an at-bat opens.** Either side may lock first
 * (ADR-0014), so the bot never waits for the human: whatever opens an at-bat —
 * `startGame`, or a resolution that leaves the game live — calls
 * {@link scheduleBotSeats} in the same transaction, which schedules a commit for
 * each seat the bot holds. A scheduled function is what lets the bot play with
 * the human's client closed.
 */

/** Whether the bot plays for this club: the seed owner holds it, on a deployment
 * where the seed is enabled. No seed-owner row means no bot, the fail-safe way. */
export async function isBotSeat(ctx: Ctx, team: Id<'teams'>): Promise<boolean> {
  if (!isSeedEnabled()) return false
  const [club, seedOwner] = await Promise.all([
    ctx.db.get(team),
    userBySubject(ctx, SEED_CLERK_SUBJECT),
  ])
  return club !== null && seedOwner !== null && club.owner === seedOwner._id
}

/**
 * Ask the bot to commit for every seat it holds in the at-bat now open on this
 * game. Reads the game fresh, so a caller that has just patched it — a start or a
 * resolution — schedules against the at-bat its own write opened. A game that is
 * no longer live has no at-bat open, so nothing is scheduled.
 */
export async function scheduleBotSeats(ctx: MutationCtx, gameId: Id<'games'>): Promise<void> {
  const game = await ctx.db.get(gameId)
  // Every caller has just written this row, so a missing one is a fault, not a
  // finished game.
  if (!game) throw new Error(`Cannot schedule the bot for game ${gameId}: it does not exist`)
  if (game.status !== 'live') return

  const sequence = game.lastResolvedSequence + 1
  const { battingTeam, pitchingTeam } = teamsForHalf(game)
  await Promise.all([
    scheduleIfBot(ctx, { game: gameId, sequence, role: 'batting', team: battingTeam }),
    scheduleIfBot(ctx, { game: gameId, sequence, role: 'pitching', team: pitchingTeam }),
  ])
}

/** One seat in the at-bat now open, and the club that fills it. */
interface OpenSeat {
  game: Id<'games'>
  sequence: number
  role: Infer<typeof duelRole>
  team: Id<'teams'>
}

async function scheduleIfBot(ctx: MutationCtx, seat: OpenSeat): Promise<void> {
  if (!(await isBotSeat(ctx, seat.team))) return
  const { game, sequence, role } = seat
  await ctx.scheduler.runAfter(0, internal.atBat.commitBotSeat, { game, sequence, role })
}
