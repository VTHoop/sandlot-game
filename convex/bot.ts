import { internal } from './_generated/api'
import type { Doc, Id } from './_generated/dataModel'
import type { MutationCtx } from './_generated/server'
import { DuelRole } from './duelContract'
import { isBotManaged, managerOfTeam, teamsForHalf } from './participants'

/**
 * The server-side bot opponent (SAN-58, ADR-0027) — who the bot is, and when it
 * is asked to play. The commit itself lives in `atBat.commitBotSeat`, so
 * `duelCommitments` keeps exactly one reader.
 *
 * **A seat is the bot's exactly when the game names the bot as that side's
 * manager** (SAN-76, ADR-0039, superseding the seed-held definition of ADR-0027).
 * Team ownership and the dev-seed flag have no say.
 *
 * **The bot commits the moment an at-bat opens.** Either side may lock first
 * (ADR-0014), so the bot never waits for the human: whatever opens an at-bat —
 * `startGame`, or a resolution that leaves the game live — calls
 * {@link scheduleBotSeats} in the same transaction, which schedules a commit for
 * each seat the bot holds. A scheduled function is what lets the bot play with
 * the human's client closed.
 */

/** Whether the bot plays this team's side of the game: exactly when the game
 * names the bot as that side's manager (SAN-76, ADR-0039). Who owns the team and
 * whether the dev seed is on have no say. */
export function isBotSeat(game: Doc<'games'>, team: Id<'teams'>): boolean {
  return isBotManaged(managerOfTeam(game, team))
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
    scheduleIfBot(ctx, game, { sequence, role: DuelRole.Batting, team: battingTeam }),
    scheduleIfBot(ctx, game, { sequence, role: DuelRole.Pitching, team: pitchingTeam }),
  ])
}

/** One seat in the at-bat now open, and the club that fills it. */
interface OpenSeat {
  sequence: number
  role: DuelRole
  team: Id<'teams'>
}

async function scheduleIfBot(ctx: MutationCtx, game: Doc<'games'>, seat: OpenSeat): Promise<void> {
  if (!isBotSeat(game, seat.team)) return
  const { sequence, role } = seat
  await ctx.scheduler.runAfter(0, internal.atBat.commitBotSeat, {
    game: game._id,
    sequence,
    role,
  })
}
