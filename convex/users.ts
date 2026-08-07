import type { UserIdentity } from 'convex/server'
import type { Id } from './_generated/dataModel'
import { type MutationCtx, mutation } from './_generated/server'

/**
 * Account provisioning (SAN-55, ADR-0023) — the one place a `users` row is born.
 *
 * `participants.ts` resolves every caller by looking a Clerk subject up in
 * `by_clerk_subject`, so until a row exists `authedUser` throws for a perfectly
 * valid signed-in user. This mints it.
 *
 * Provisioning is an explicit mutation for the client to call at sign-in — that
 * wiring is SAN-38's and is not in place yet — rather than a lazy write inside
 * `maybeUser`: that helper takes a `QueryCtx | MutationCtx` and Convex queries
 * cannot write, so a first-time user would still fail every read — and every
 * gated mutation would quietly become an account-creation path.
 *
 * The subject is read only from `ctx.auth` and the mutation takes no arguments,
 * so a caller can provision itself and nothing else. The dev fixture's owner row
 * (`SEED_CLERK_SUBJECT`) is keyed the same way on a subject shape Clerk cannot
 * issue, so neither side can reach the other's row.
 */

/** Used when a Clerk identity carries no name, username, or email at all. */
const FALLBACK_DISPLAY_NAME = 'Manager'

/** A claim that is absent, empty, or only whitespace is no claim at all. */
function claimed(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed === '' ? undefined : trimmed
}

/** The part of an email address before the `@` — `''` for `@example.com`. */
function emailLocalPart(email: string | undefined): string | undefined {
  const [local] = email?.split('@') ?? []
  return claimed(local)
}

/**
 * The name to put on a new row. Clerk's `convex` JWT template maps `name` to the
 * account's full name and `nickname` to its username, either of which the user
 * may have left blank — so the chain descends to the email local-part and finally
 * to a constant. The result is never empty: `displayName` is not optional, and a
 * blank one would render as a nameless manager everywhere it is shown.
 */
function displayNameFor(identity: UserIdentity): string {
  return (
    claimed(identity.name) ??
    claimed(identity.nickname) ??
    emailLocalPart(identity.email) ??
    FALLBACK_DISPLAY_NAME
  )
}

/**
 * The row for `clerkSubject`, created on first sight and reused forever after.
 *
 * Safe to race without a unique constraint (`users` has none) because it reads
 * the index range it then inserts into: two concurrent first-time calls for the
 * same subject overlap read and write sets, so Convex's serializable OCC
 * conflicts one and its retry finds the committed row. That matters more here
 * than it looks — `by_clerk_subject` is read with `.unique()`, which *throws* on
 * a duplicate, so a lost race would not degrade the account, it would break every
 * later lookup for it. Same discipline as the duel's ordinal (SAN-20).
 *
 * Never patches an existing row: `displayName` is the user's own column, seeded
 * from Clerk once and thereafter owned by the app (a profile screen, eventually).
 * Re-syncing on every sign-in would silently revert whatever they set.
 */
export async function upsertUserBySubject(
  ctx: MutationCtx,
  clerkSubject: string,
  displayName: string,
): Promise<Id<'users'>> {
  const existing = await ctx.db
    .query('users')
    .withIndex('by_clerk_subject', (q) => q.eq('clerkSubject', clerkSubject))
    .unique()
  return existing?._id ?? ctx.db.insert('users', { clerkSubject, displayName })
}

/**
 * Provision the calling Clerk user, returning their `users` row id. Idempotent:
 * a returning caller gets the same id back and nothing is written. Meant to be
 * called by the client at sign-in (SAN-38 owns that wiring); until it has run,
 * the caller reads as unauthenticated.
 */
export const provision = mutation({
  args: {},
  handler: async (ctx): Promise<Id<'users'>> => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) throw new Error('Not authenticated')
    return upsertUserBySubject(ctx, identity.subject, displayNameFor(identity))
  },
})
