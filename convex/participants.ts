import type { UserIdentity } from 'convex/server'
import type { Doc, Id } from './_generated/dataModel'
import type { MutationCtx, QueryCtx } from './_generated/server'

/**
 * Shared Clerk-auth + team-ownership helpers for participant gating. Used by the
 * secret at-bat round-trip (`atBat.ts`), the authoritative game-state mutations
 * (`game.ts`), and account provisioning (`users.ts`) so the auth rules live in
 * exactly one place. The Clerk subject (`ctx.auth.subject`) maps to a `users` row
 * via `by_clerk_subject` (docs/ABSTRACTIONS.md → ConvexProviderWithClerk).
 *
 * `ctx.auth.getUserIdentity()` and the `Not authenticated` message are spelled
 * only here. A caller that needs the raw identity — provisioning, which resolves
 * a row that does not exist yet — takes {@link authedIdentity} rather than
 * reading `ctx.auth` itself.
 */

export type Ctx = QueryCtx | MutationCtx

/** One message for "no caller" and "caller has no row": both are unauthenticated
 * as far as any gated function is concerned, and the difference is not the
 * client's business. */
const NOT_AUTHENTICATED = 'Not authenticated'

/**
 * The `users` row for a Clerk subject, or null. The single reader of
 * `by_clerk_subject`, and deliberately so on two counts:
 *
 * `.unique()` **throws** on a duplicate rather than picking a winner, which is
 * what makes a duplicated row a hard failure instead of a silent account
 * hijack — every gate depends on that staying loud.
 *
 * It is also the read half of `users.upsertUserBySubject`, whose safety without
 * a unique constraint rests on reading exactly this index range before inserting
 * into it. Narrowing, caching, or relaxing this query breaks that OCC argument
 * in a file that does not mention it.
 */
export function userBySubject(ctx: Ctx, subject: string): Promise<Doc<'users'> | null> {
  return ctx.db
    .query('users')
    .withIndex('by_clerk_subject', (q) => q.eq('clerkSubject', subject))
    .unique()
}

/** The caller's Clerk identity, or throw when there is no caller. For the one
 * caller that needs the identity itself rather than the row behind it. */
export async function authedIdentity(ctx: Ctx): Promise<UserIdentity> {
  const identity = await ctx.auth.getUserIdentity()
  if (!identity) throw new Error(NOT_AUTHENTICATED)
  return identity
}

/** The authenticated user's row, or null when unauthenticated / not yet provisioned. */
export async function maybeUser(ctx: Ctx): Promise<Doc<'users'> | null> {
  const identity = await ctx.auth.getUserIdentity()
  return identity ? userBySubject(ctx, identity.subject) : null
}

/** The authenticated user's row, or throw when there is no caller. */
export async function authedUser(ctx: Ctx): Promise<Doc<'users'>> {
  const user = await maybeUser(ctx)
  if (!user) throw new Error(NOT_AUTHENTICATED)
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
