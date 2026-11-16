import type { UserIdentity } from 'convex/server'
import type { Doc, Id } from './_generated/dataModel'
import type { MutationCtx, QueryCtx } from './_generated/server'
import { ClubSide } from './clubSide'

/**
 * Shared Clerk-auth + game-manager helpers for participant gating. Used by the
 * secret at-bat round-trip (`atBat.ts`), the authoritative game-state mutations
 * (`game.ts`), and account provisioning (`users.ts`) so the auth rules live in
 * exactly one place. {@link gamesManagedBy}, the one non-gating helper, is the
 * "My games" read model's lookup (`myGames.ts`). The Clerk subject — `subject` on the `UserIdentity` that
 * `ctx.auth.getUserIdentity()` returns — maps to a `users` row via
 * `by_clerk_subject` (docs/ABSTRACTIONS.md → ConvexProviderWithClerk).
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

/** One side's manager, as the schema persists it. */
export type Manager = NonNullable<Doc<'games'>['homeManager']>

/** Both sides' managers. */
export interface GameManagers {
  home: Manager
  away: Manager
}

/**
 * The managers of a game (SAN-76, ADR-0039) — the only door onto them. The schema
 * fields are optional until the backfill has run everywhere, so a game without
 * them is corrupt state: refuse rather than guess who plays it.
 */
export function managersOf(game: Doc<'games'>): GameManagers {
  if (!game.homeManager || !game.awayManager) {
    throw new Error(`Game ${game._id} has no managers recorded; run seed:backfillGameManagers`)
  }
  return { home: game.homeManager, away: game.awayManager }
}

/** Whether `manager` is this user. The bot is nobody's account. */
export function isManagedBy(manager: Manager, user: Doc<'users'>): boolean {
  return manager.kind === 'user' && manager.user === user._id
}

/** Whether this side of the game is played by the bot. */
export function isBotManaged(manager: Manager): boolean {
  return manager.kind === 'bot'
}

/** The manager of the side `team` plays for in this game. */
export function managerOfTeam(game: Doc<'games'>, team: Id<'teams'>): Manager {
  const managers = managersOf(game)
  return team === game.homeTeam ? managers.home : managers.away
}

/**
 * Which of the game's two sides the caller manages — both, for the one-account
 * hotseat (ADR-0028). Two named flags rather than a list, so a reader asks for the
 * side it means instead of searching. Team ownership plays no part (ADR-0039).
 */
export interface ManagedSides {
  home: boolean
  away: boolean
}

/** Which of the game's sides `user` manages. */
export function managedSides(game: Doc<'games'>, user: Doc<'users'>): ManagedSides {
  const managers = managersOf(game)
  return { home: isManagedBy(managers.home, user), away: isManagedBy(managers.away, user) }
}

/** Whether the user manages either side — the one definition every participant
 * gate reads, read model and mutation alike. */
export const isParticipant = (sides: ManagedSides): boolean => sides.home || sides.away

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

/**
 * Whether one club's seat in the at-bat now open has locked, given the game's
 * lock state. Either seat may lock first (ADR-0014); which role a club holds
 * flips every half (SAN-21), so the lock is read through the half. Shared by the
 * "My games" read model and the push scheduler, which both ask it of a club.
 */
export function sideLocked(
  game: Doc<'games'>,
  locks: { pitchCommitted: boolean; swingCommitted: boolean },
  side: ClubSide,
): boolean {
  const homeBats = teamsForHalf(game).battingTeam === game.homeTeam
  const batting = homeBats === (side === ClubSide.Home)
  return batting ? locks.swingCommitted : locks.pitchCommitted
}

/** Every game `user` manages a side of, each once — one account managing both
 * sides of a game finds it through both indexes. */
export async function gamesManagedBy(ctx: Ctx, user: Doc<'users'>): Promise<Doc<'games'>[]> {
  const [home, away] = await Promise.all([
    ctx.db
      .query('games')
      .withIndex('by_home_manager', (q) => q.eq('homeManager.user', user._id))
      .collect(),
    ctx.db
      .query('games')
      .withIndex('by_away_manager', (q) => q.eq('awayManager.user', user._id))
      .collect(),
  ])
  return [...new Map([...home, ...away].map((game) => [game._id, game])).values()]
}
