import type { Doc, Id } from './_generated/dataModel'
import type { MutationCtx, QueryCtx } from './_generated/server'

/**
 * Shared Clerk-auth + team-ownership helpers for participant gating. Used by both
 * the secret at-bat round-trip (`atBat.ts`) and the authoritative game-state
 * mutations (`game.ts`) so the auth rules live in exactly one place. The Clerk
 * subject (`ctx.auth.subject`) maps to a `users` row via `by_clerk_subject`
 * (docs/ABSTRACTIONS.md → ConvexProviderWithClerk).
 */

export type Ctx = QueryCtx | MutationCtx

function userBySubject(ctx: Ctx, subject: string): Promise<Doc<'users'> | null> {
  return ctx.db
    .query('users')
    .withIndex('by_clerk_subject', (q) => q.eq('clerkSubject', subject))
    .unique()
}

/** The authenticated user's row, or null when unauthenticated / not yet provisioned. */
export async function maybeUser(ctx: Ctx): Promise<Doc<'users'> | null> {
  const identity = await ctx.auth.getUserIdentity()
  return identity ? userBySubject(ctx, identity.subject) : null
}

/** The authenticated user's row, or throw when there is no caller. */
export async function authedUser(ctx: Ctx): Promise<Doc<'users'>> {
  const user = await maybeUser(ctx)
  if (!user) throw new Error('Not authenticated')
  return user
}

/** Whether `user` owns the given team. */
export async function ownsTeam(ctx: Ctx, team: Id<'teams'>, user: Doc<'users'>): Promise<boolean> {
  const doc = await ctx.db.get(team)
  return doc !== null && doc.owner === user._id
}

export async function assertOwns(ctx: Ctx, team: Id<'teams'>, user: Doc<'users'>): Promise<void> {
  if (!(await ownsTeam(ctx, team, user))) throw new Error('Not authorized for this team')
}

/**
 * In the top half the away team bats and the home team pitches; the bottom half
 * is the mirror. (Fielding/pitching side is the team NOT at bat.)
 */
export function teamsForHalf(game: Doc<'games'>): {
  battingTeam: Id<'teams'>
  pitchingTeam: Id<'teams'>
} {
  return game.half === 'top'
    ? { battingTeam: game.awayTeam, pitchingTeam: game.homeTeam }
    : { battingTeam: game.homeTeam, pitchingTeam: game.awayTeam }
}
