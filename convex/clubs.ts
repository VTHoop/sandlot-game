import { v } from 'convex/values'
import type { Doc, Id } from './_generated/dataModel'
import { mutation, query } from './_generated/server'
import { authedUser, type Ctx, maybeUser, userBySubject } from './participants'
import { SEED_CLERK_SUBJECT } from './seed'

/**
 * Self-serve club claiming (SAN-63, ADR-0024) — the browser-reachable half of
 * becoming a game participant.
 *
 * Provisioning (SAN-55) mints a `users` row; it grants nothing. Every gate in
 * `atBat.ts` / `game.ts` runs through `ownsTeam`, so a signed-in human is a
 * spectator until a club's `owner` points at them. `seed.assignClubToUser`
 * (SAN-62) performs that move from a CLI, which is enough for one developer and
 * not enough for a family: this is the path a real user can drive themselves.
 *
 * **A club is claimable exactly when the seed owner holds it.** That predicate
 * is deliberately not a column and not a Clerk-subject shape check — see
 * ADR-0024 for both rejected alternatives. It also fails *safe*: on a deployment
 * where the seed never ran there is no seed-owner row, so nothing is claimable
 * and {@link availability} answers `none_left` rather than offering someone
 * else's club.
 *
 * **One club per user** — six family members, six clubs, one each — is a durable
 * product rule, and this is the only path a real user can drive, so this is
 * where it is enforced. SAN-62's dev-only assignment stays exempt on purpose, so
 * the rule never has to bend for local development.
 *
 * Both refusals {@link claim} makes are safe to race without a unique constraint
 * (neither `teams.owner` nor `by_owner` has one) because each reads the range it
 * then writes into. Two callers reaching for the same club both read that club's
 * row and both patch it, so Convex's serializable OCC conflicts the loser — and
 * its retry re-reads a club the seed owner no longer holds, and refuses. One
 * caller reaching for two clubs at once is the same argument on the other index:
 * both attempts read the caller's `by_owner` range, and patching an `owner` to
 * the caller writes into it. Same discipline as the duel's ordinal (SAN-20) and
 * the provisioning upsert (SAN-55).
 *
 * Where the claim is offered in the app — the screen, the routing — belongs to
 * the app shell (SAN-38), not here.
 */

/**
 * What the availability read has to say to its caller. The four are separate
 * because they are separate screens: "nothing left to take" and "you already
 * hold a club" are not the same message, and an empty list plus a guess renders
 * the wrong one for one of them.
 */
export enum ClaimStatus {
  /** No identity, or an identity with no `users` row — the same thing to every
   * gate, and the same thing here (see `participants.ts`). */
  Unauthenticated = 'unauthenticated',
  /** Clubs the caller may take, at least one. */
  Available = 'available',
  /** The caller already holds a club, so they may take no other. */
  Holding = 'holding',
  /** Signed in, holding nothing, and nothing left to hold. */
  NoneLeft = 'none_left',
}

/**
 * Enough club identity to choose between clubs, and nothing else. This read
 * reaches a signed-in *non-participant*, so a roster or a live score arriving
 * here would be a game-integrity leak (AGENTS.md § Game integrity). Even the
 * `owner` is withheld: it answers "who else is playing" for a caller who has not
 * joined yet, and no screen needs it to pick a club.
 */
export interface ClubSummary {
  id: Id<'teams'>
  name: string
}

export type ClubAvailability =
  | { status: ClaimStatus.Unauthenticated }
  | { status: ClaimStatus.Available; clubs: ClubSummary[] }
  | { status: ClaimStatus.Holding; club: ClubSummary }
  | { status: ClaimStatus.NoneLeft }

/** Alphabetical, so a picker's order comes from the clubs rather than from the
 * order the fixture happened to insert them in. */
function byName(a: Doc<'teams'>, b: Doc<'teams'>): number {
  if (a.name === b.name) return 0
  return a.name < b.name ? -1 : 1
}

function summarize(club: Doc<'teams'>): ClubSummary {
  return { id: club._id, name: club.name }
}

/**
 * Every club one user holds. The read the one-club rule is enforced on, and the
 * range a claim writes into — which is what makes the rule race-proof rather
 * than merely checked (see the module comment).
 */
async function clubsHeldBy(ctx: Ctx, owner: Id<'users'>): Promise<Doc<'teams'>[]> {
  const clubs = await ctx.db
    .query('teams')
    .withIndex('by_owner', (q) => q.eq('owner', owner))
    .collect()
  return clubs.sort(byName)
}

/**
 * The clubs still on offer: exactly the ones the seed owner holds. No seed-owner
 * row — a deployment the seed never ran on — means nothing is claimable, which
 * is the fail-safe direction.
 */
async function claimableClubs(ctx: Ctx): Promise<Doc<'teams'>[]> {
  const seedOwner = await userBySubject(ctx, SEED_CLERK_SUBJECT)
  return seedOwner ? clubsHeldBy(ctx, seedOwner._id) : []
}

/**
 * What the calling user may do about a club: their own club, the clubs on offer,
 * or neither. Answers a *status* rather than a list — see {@link ClaimStatus}.
 *
 * Unauthenticated is an answer, not an error: the sign-in flow calls
 * `users.provision` (SAN-38 owns that wiring), and until it has run a perfectly
 * valid signed-in caller has no row. Every other participant-gated query in this
 * codebase returns rather than throws for that caller, and a claim screen has to
 * render something during exactly that window.
 */
export const availability = query({
  args: {},
  handler: async (ctx): Promise<ClubAvailability> => {
    const user = await maybeUser(ctx)
    if (!user) return { status: ClaimStatus.Unauthenticated }

    // One club per user, so the first held club is the whole answer.
    const [held] = await clubsHeldBy(ctx, user._id)
    if (held) return { status: ClaimStatus.Holding, club: summarize(held) }

    const clubs = await claimableClubs(ctx)
    if (clubs.length === 0) return { status: ClaimStatus.NoneLeft }
    return { status: ClaimStatus.Available, clubs: clubs.map(summarize) }
  },
})

/**
 * Take a club, making the caller a participant in every game it plays.
 *
 * It names the club and nothing else: the recipient is always `ctx.auth`, so a
 * caller can claim for itself and nothing else. `clubs.test.ts` carries a
 * compile-time guard that fails `pnpm typecheck` if a recipient argument is ever
 * added — that argument is what would turn this into SAN-62's assignment tool
 * with the fences taken off.
 *
 * Three refusals, in the order a caller hits them: the caller must be
 * provisioned, must hold no club already, and must be reaching for a club the
 * seed owner still holds. The last one is what a real user's club is protected
 * by — it is the operation the dev-only path deliberately allows and this one
 * must not.
 *
 * There is no "already yours" success case. Re-claiming a club you hold is
 * refused by the one-club rule rather than passing as a no-op: the client that
 * sends it is working from a stale view, and a silent success would leave it
 * believing something about the league that may no longer be true.
 */
export const claim = mutation({
  args: { team: v.id('teams') },
  handler: async (ctx, { team }): Promise<void> => {
    const user = await authedUser(ctx)

    const [held] = await clubsHeldBy(ctx, user._id)
    if (held) {
      throw new Error(
        `You already hold "${held.name}" — the league is one club per manager, ` +
          `so there is no second club to take.`,
      )
    }

    const club = await ctx.db.get(team)
    if (!club) throw new Error(`There is no club by id ${team} to claim.`)

    const seedOwner = await userBySubject(ctx, SEED_CLERK_SUBJECT)
    if (!seedOwner || club.owner !== seedOwner._id) {
      throw new Error(`"${club.name}" is already held by another manager.`)
    }

    await ctx.db.patch(team, { owner: user._id })
  },
})
