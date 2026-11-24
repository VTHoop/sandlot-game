import { v } from 'convex/values'
import type { Id } from './_generated/dataModel'
import { internalMutation, type MutationCtx, mutation } from './_generated/server'
import { ClubSide } from './clubSide'
import { type BuiltLineup, buildLineup } from './lineup'
import { authedUser, isBotManaged, type Manager } from './participants'
import { SCHEDULED_GAME } from './scheduledGame'
import { manager } from './validators'

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

/** Who plays a pickup game and where: a real MLB team per side, each run by a user or the bot. */
export interface PickupGameSides {
  homeTeam: string
  awayTeam: string
  homeManager: Manager
  awayManager: Manager
}

/** A user manager must be a real account; the bot is nobody's row. */
async function requireManagerExists(
  ctx: MutationCtx,
  side: ClubSide,
  manager: Manager,
): Promise<void> {
  if (manager.kind === 'bot') return
  if (!(await ctx.db.get(manager.user))) throw new Error(`The ${side} manager does not exist`)
}

/**
 * Every refusal in one place, run before the first write, and the lineups it
 * builds along the way — a team with no lineup is one of the refusals, and the
 * lineup is what proves it. The bot on both sides is refused because nobody could
 * ever start that game (ADR-0027, ADR-0039).
 */
async function validateAndBuildLineups(
  ctx: MutationCtx,
  { homeTeam, awayTeam, homeManager, awayManager }: PickupGameSides,
): Promise<{ home: BuiltLineup; away: BuiltLineup }> {
  if (homeTeam === awayTeam) throw new Error('The same team cannot play on both sides')
  if (isBotManaged(homeManager) && isBotManaged(awayManager)) {
    throw new Error('The bot cannot manage both sides of a game')
  }
  await requireManagerExists(ctx, ClubSide.Home, homeManager)
  await requireManagerExists(ctx, ClubSide.Away, awayManager)

  const players = await ctx.db
    .query('players')
    .withIndex('by_source', (q) => q.eq('source', 'mlb'))
    .collect()
  return { home: buildLineup(homeTeam, players), away: buildLineup(awayTeam, players) }
}

/**
 * The creation core of a pickup game (SAN-78, ADR-0041; managers SAN-84): a
 * `scheduled` game between two real MLB teams with the managers it is given, a
 * lineup per side, and `pickup: true`, which keeps it out of standings. The
 * existing `startGame` opens it.
 *
 * It does **no sign-in**: who may be named as a manager is the caller's call, and
 * it is deliberately not a public argument — a client that could name any account
 * would put games in someone else's list without their consent. Each caller
 * establishes consent its own way: `createPickupGame` is the caller themselves on
 * both sides; an open challenge is the other person's join (SAN-80).
 *
 * A plain function rather than an internal mutation, so a caller runs it inside its
 * own transaction. All validation runs before the first write, so a refusal leaves
 * no game, lineup or `teams` row behind; the surrounding transaction is what would
 * undo a write if a later one failed.
 */
export async function createGameBetween(
  ctx: MutationCtx,
  sides: PickupGameSides,
): Promise<Id<'games'>> {
  const lineups = await validateAndBuildLineups(ctx, sides)

  const home = await realTeam(ctx, sides.homeTeam)
  const away = await realTeam(ctx, sides.awayTeam)
  const game = await ctx.db.insert('games', {
    homeTeam: home,
    awayTeam: away,
    homeManager: sides.homeManager,
    awayManager: sides.awayManager,
    pickup: true,
    ...SCHEDULED_GAME,
  })
  await insertLineup(ctx, game, home, lineups.home)
  await insertLineup(ctx, game, away, lineups.away)
  return game
}

/**
 * Start a pickup game with the caller as both managers (SAN-78, ADR-0041); the
 * existing `startGame` opens it. Signs the caller in, then {@link createGameBetween}.
 */
export const createPickupGame = mutation({
  args: { homeTeam: v.string(), awayTeam: v.string() },
  handler: async (ctx, { homeTeam, awayTeam }): Promise<Id<'games'>> => {
    const user = await authedUser(ctx)
    const manager = { kind: 'user', user: user._id } as const
    return createGameBetween(ctx, {
      homeTeam,
      awayTeam,
      homeManager: manager,
      awayManager: manager,
    })
  },
})

/** Stub (SAN-84): the runnable form of {@link createGameBetween}. */
export const createPickupGameFor = internalMutation({
  args: {
    homeTeam: v.string(),
    awayTeam: v.string(),
    homeManager: manager,
    awayManager: manager,
  },
  handler: async (_ctx, _args): Promise<Id<'games'>> => {
    throw new Error('createPickupGameFor is not implemented')
  },
})
