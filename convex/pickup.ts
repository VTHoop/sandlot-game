import { v } from 'convex/values'
import type { Id } from './_generated/dataModel'
import { type MutationCtx, mutation } from './_generated/server'
import { type BuiltLineup, buildLineup } from './lineup'
import { authedUser } from './participants'
import { SCHEDULED_GAME } from './scheduledGame'

/**
 * Start a pickup game between two real MLB teams (SAN-78, ADR-0041). The caller
 * manages both sides; the game is `scheduled`, so the existing `startGame` opens
 * it, and carries `pickup: true`, which keeps it out of standings.
 *
 * A mutation is one transaction, so a throw leaves no game, lineup or `teams` row
 * behind. Every refusal today comes from validation, which runs before the first
 * write; the transaction is what would undo a write if a later one failed.
 */

/**
 * The `teams` row of a real MLB team: the ownerless row of that name, created on
 * the first pick. Reading the `by_name` range before inserting into it is what makes
 * two simultaneous first picks safe — the loser retries and finds the winner's row.
 */
async function realTeam(ctx: MutationCtx, name: string): Promise<Id<'teams'>> {
  const named = await ctx.db
    .query('teams')
    .withIndex('by_name', (q) => q.eq('name', name))
    .collect()
  return named.find((team) => team.owner === undefined)?._id ?? ctx.db.insert('teams', { name })
}

async function insertLineup(
  ctx: MutationCtx,
  game: Id<'games'>,
  team: Id<'teams'>,
  lineup: BuiltLineup,
): Promise<void> {
  await ctx.db.insert('lineups', { game, team, ...lineup })
}

export const createPickupGame = mutation({
  args: { homeTeam: v.string(), awayTeam: v.string() },
  handler: async (ctx, { homeTeam, awayTeam }): Promise<Id<'games'>> => {
    const user = await authedUser(ctx)
    if (homeTeam === awayTeam) throw new Error('The same team cannot play on both sides')

    const players = await ctx.db
      .query('players')
      .withIndex('by_source', (q) => q.eq('source', 'mlb'))
      .collect()
    const homeLineup = buildLineup(homeTeam, players)
    const awayLineup = buildLineup(awayTeam, players)

    const home = await realTeam(ctx, homeTeam)
    const away = await realTeam(ctx, awayTeam)
    const manager = { kind: 'user', user: user._id } as const
    const game = await ctx.db.insert('games', {
      homeTeam: home,
      awayTeam: away,
      homeManager: manager,
      awayManager: manager,
      pickup: true,
      ...SCHEDULED_GAME,
    })
    await insertLineup(ctx, game, home, homeLineup)
    await insertLineup(ctx, game, away, awayLineup)
    return game
  },
})
