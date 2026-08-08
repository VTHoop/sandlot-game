// @vitest-environment edge-runtime
/// <reference types="vite/client" />

import type { FunctionArgs } from 'convex/server'
import { convexTest } from 'convex-test'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { api, internal } from './_generated/api'
import type { Id } from './_generated/dataModel'
import { ClaimStatus, type ClubAvailability } from './clubs'
import { ownsTeam, userBySubject } from './participants'
import schema from './schema'
import { SEED_CLERK_SUBJECT, SEED_ENV_FLAG } from './seed'
import { AWAY_TEAM, HOME_TEAM } from './seedRoster'

// convex-test discovers the function modules; exclude the test files themselves.
const modules = import.meta.glob(['./**/*.ts', '!./**/*.test.ts'])

/**
 * Compile-time guard for "a caller can claim a club only for itself": `claim`
 * names the club and nothing else, so the recipient can only come from
 * `ctx.auth`. Add a `clerkSubject`/`user` argument — turning the public path
 * into SAN-62's dev-only assignment tool — and this resolves to `never` and
 * `pnpm typecheck` fails.
 */
type ClaimNamesOnlyTheClub = [keyof FunctionArgs<typeof api.clubs.claim>] extends ['team']
  ? true
  : never
const _claimNamesOnlyTheClub: ClaimNamesOnlyTheClub = true
void _claimNamesOnlyTheClub

/** A real signed-in Clerk account, and a second one to contend with it. */
const FIRST = 'user_first_manager'
const SECOND = 'user_second_manager'

function harness() {
  return convexTest(schema, modules)
}

type Harness = ReturnType<typeof harness>

/** Stand up the dev league: the seed owner holding both clubs, and a game. */
function bootstrap(t: Harness): Promise<Id<'games'>> {
  vi.stubEnv(SEED_ENV_FLAG, 'true')
  return t.mutation(internal.seed.bootstrapDevLeague, {})
}

/** Mint a real user's row the one way the app mints one (SAN-55). */
function provision(t: Harness, subject: string): Promise<Id<'users'>> {
  return t.withIdentity({ subject }).mutation(api.users.provision, {})
}

/** The availability read as a given caller, or as nobody when no subject. */
function availability(t: Harness, subject?: string): Promise<ClubAvailability> {
  const caller = subject === undefined ? t : t.withIdentity({ subject })
  return caller.query(api.clubs.availability, {})
}

function claim(t: Harness, team: Id<'teams'>, subject: string): Promise<null> {
  return t.withIdentity({ subject }).mutation(api.clubs.claim, { team })
}

/** Provision a caller and take a club — the whole self-serve path in one call. */
async function provisionAndClaim(t: Harness, team: Id<'teams'>, subject: string): Promise<void> {
  await provision(t, subject)
  await claim(t, team, subject)
}

/**
 * Every club as `name:holder-subject`, sorted — the whole ownership picture in
 * one value, so a test that cares about one club still fails if another moved.
 */
function ownership(t: Harness): Promise<string[]> {
  return t.run(async (ctx) => {
    const teams = await ctx.db.query('teams').collect()
    const rows = await Promise.all(
      teams.map(async (team) => {
        const owner = await ctx.db.get(team.owner)
        return `${team.name}:${owner?.clerkSubject ?? 'ghost'}`
      }),
    )
    return rows.sort()
  })
}

/** Whether the subject's user row owns the club, through the gate itself. */
function holds(t: Harness, team: Id<'teams'>, subject: string): Promise<boolean> {
  return t.run(async (ctx) => {
    const user = await userBySubject(ctx, subject)
    return user !== null && ownsTeam(ctx, team, user)
  })
}

/** Bootstrap once and resolve both club ids off the game it returns. */
async function seeded() {
  const t = harness()
  const game = await bootstrap(t)
  const row = await t.run((ctx) => ctx.db.get(game))
  if (!row) throw new Error('seed returned an id with no game behind it')
  return { t, game, home: row.homeTeam, away: row.awayTeam }
}

/** A club id whose row is gone — the id a stale client would send. */
async function vanishedClub(t: Harness): Promise<Id<'teams'>> {
  return t.run(async (ctx) => {
    const owner = await ctx.db.insert('users', { clerkSubject: 'user_ghost', displayName: 'Ghost' })
    const team = await ctx.db.insert('teams', { owner, name: 'Deleted Club' })
    await ctx.db.delete(team)
    return team
  })
}

afterEach(() => {
  vi.unstubAllEnvs()
})

/**
 * The read answers the caller's *status*, not a list with a status attached:
 * "nothing left to take" and "you already hold one" are different screens, and
 * an empty array cannot tell them apart. Each case is asserted with `toEqual`
 * on the whole view, which is also what pins the exposure boundary below —
 * anything the query starts returning has to come argue with these.
 */
describe('club availability — the caller’s status', () => {
  it('answers unauthenticated to a caller with no identity at all', async () => {
    const { t } = await seeded()
    expect(await availability(t)).toEqual({ status: ClaimStatus.Unauthenticated })
  })

  it('answers unauthenticated to a signed-in caller with no users row', async () => {
    const { t } = await seeded()
    expect(await availability(t, FIRST)).toEqual({ status: ClaimStatus.Unauthenticated })
  })

  it('lists the clubs the seed owner still holds, by name', async () => {
    const { t, home, away } = await seeded()
    await provision(t, FIRST)

    expect(await availability(t, FIRST)).toEqual({
      status: ClaimStatus.Available,
      clubs: [
        { id: away, name: AWAY_TEAM.name },
        { id: home, name: HOME_TEAM.name },
      ],
    })
  })

  it('answers holding, with the caller’s own club, once they have taken one', async () => {
    const { t, away } = await seeded()
    await provisionAndClaim(t, away, FIRST)

    expect(await availability(t, FIRST)).toEqual({
      status: ClaimStatus.Holding,
      club: { id: away, name: AWAY_TEAM.name },
    })
  })

  it('answers none-left when every club is spoken for and the caller holds none', async () => {
    const { t, home, away } = await seeded()
    await provisionAndClaim(t, home, FIRST)
    await provisionAndClaim(t, away, SECOND)
    await provision(t, 'user_late_arrival')

    expect(await availability(t, 'user_late_arrival')).toEqual({ status: ClaimStatus.NoneLeft })
  })

  it('answers none-left on a deployment where the seed never ran', async () => {
    const t = harness()
    await provision(t, FIRST)

    expect(await availability(t, FIRST)).toEqual({ status: ClaimStatus.NoneLeft })
  })

  it('stops offering a club once someone else has taken it', async () => {
    const { t, home, away } = await seeded()
    await provisionAndClaim(t, away, FIRST)
    await provision(t, SECOND)

    expect(await availability(t, SECOND)).toEqual({
      status: ClaimStatus.Available,
      clubs: [{ id: home, name: HOME_TEAM.name }],
    })
  })
})

/**
 * The read reaches a signed-in non-participant, so it may carry only enough to
 * choose between clubs. A roster or a live score arriving here would be a
 * game-integrity leak, and the shape assertions above are how that stays true —
 * this states it directly so the reason survives a refactor.
 */
describe('club availability — what it exposes', () => {
  it('carries an id and a name per club, and nothing else', async () => {
    const { t } = await seeded()
    await provision(t, FIRST)

    const view = await availability(t, FIRST)
    if (view.status !== ClaimStatus.Available) throw new Error(`expected clubs, got ${view.status}`)
    for (const club of view.clubs) {
      expect(Object.keys(club).sort()).toEqual(['id', 'name'])
    }
  })

  it('carries neither the owner nor anything reachable through it', async () => {
    const { t } = await seeded()
    await provision(t, FIRST)

    const serialized = JSON.stringify(await availability(t, FIRST))
    const owner = await t.run((ctx) => userBySubject(ctx, SEED_CLERK_SUBJECT))
    expect(serialized).not.toContain(owner?._id)
    expect(serialized).not.toContain('owner')
  })
})

describe('claiming a club — who may call it', () => {
  it('refuses a caller with no identity at all', async () => {
    const { t, away } = await seeded()
    await expect(t.mutation(api.clubs.claim, { team: away })).rejects.toThrow(/Not authenticated/)
  })

  it('refuses a signed-in caller with no users row', async () => {
    const { t, away } = await seeded()
    await expect(claim(t, away, FIRST)).rejects.toThrow(/Not authenticated/)
  })

  it('moves no club when it refuses an unprovisioned caller', async () => {
    const { t, away } = await seeded()
    const before = await ownership(t)

    await expect(claim(t, away, FIRST)).rejects.toThrow()

    expect(await ownership(t)).toEqual(before)
  })
})

describe('claiming a club — taking an unheld one', () => {
  it('hands the club to the caller', async () => {
    const { t, away } = await seeded()
    await provisionAndClaim(t, away, FIRST)

    expect(await holds(t, away, FIRST)).toBe(true)
  })

  it('leaves the seed owner’s other club alone, so the bot still has a team', async () => {
    const { t, home, away } = await seeded()
    await provisionAndClaim(t, away, FIRST)

    expect(await ownership(t)).toEqual([
      `${AWAY_TEAM.name}:${FIRST}`,
      `${HOME_TEAM.name}:${SEED_CLERK_SUBJECT}`,
    ])
    expect(await holds(t, home, SEED_CLERK_SUBJECT)).toBe(true)
  })

  it('lets the new owner start the game and swing — the participant gates pass', async () => {
    const { t, game, away } = await seeded()
    await provisionAndClaim(t, away, FIRST)

    // The away club bats in the top half: its new owner swings, the seed owner
    // still holds the home club and pitches.
    await t.withIdentity({ subject: FIRST }).mutation(api.game.startGame, { game })
    await t
      .withIdentity({ subject: SEED_CLERK_SUBJECT })
      .mutation(api.atBat.commitPitch, { game, number: 500 })
    await t.withIdentity({ subject: FIRST }).mutation(api.atBat.commitSwing, { game, number: 500 })

    expect(await t.run((ctx) => ctx.db.query('atBats').collect())).toHaveLength(1)
  })

  it('refuses an id with no club behind it', async () => {
    const { t } = await seeded()
    await provision(t, FIRST)

    await expect(claim(t, await vanishedClub(t), FIRST)).rejects.toThrow(/no club/i)
  })
})

/**
 * The two refusals SAN-62's dev-only assignment deliberately does not make.
 * Both are the durable product rule — six family members, six clubs, one each —
 * and this is the only path a real user can drive, so this is where it lives.
 */
describe('claiming a club — a club someone already holds', () => {
  it('refuses to take a club from another real user', async () => {
    const { t, away } = await seeded()
    await provisionAndClaim(t, away, FIRST)
    await provision(t, SECOND)

    await expect(claim(t, away, SECOND)).rejects.toThrow(/already/i)
  })

  it('leaves it with its holder when it refuses', async () => {
    const { t, away } = await seeded()
    await provisionAndClaim(t, away, FIRST)
    await provision(t, SECOND)

    await expect(claim(t, away, SECOND)).rejects.toThrow()

    expect(await holds(t, away, FIRST)).toBe(true)
    expect(await holds(t, away, SECOND)).toBe(false)
  })
})

describe('claiming a club — a caller who already holds one', () => {
  it('refuses a second club', async () => {
    const { t, home, away } = await seeded()
    await provisionAndClaim(t, away, FIRST)

    await expect(claim(t, home, FIRST)).rejects.toThrow(/one club/i)
  })

  it('leaves both the club they hold and the one they reached for untouched', async () => {
    const { t, home, away } = await seeded()
    await provisionAndClaim(t, away, FIRST)

    await expect(claim(t, home, FIRST)).rejects.toThrow()

    expect(await ownership(t)).toEqual([
      `${AWAY_TEAM.name}:${FIRST}`,
      `${HOME_TEAM.name}:${SEED_CLERK_SUBJECT}`,
    ])
  })

  it('refuses even the club they already hold, rather than passing as a no-op', async () => {
    const { t, away } = await seeded()
    await provisionAndClaim(t, away, FIRST)

    await expect(claim(t, away, FIRST)).rejects.toThrow()
    expect(await holds(t, away, FIRST)).toBe(true)
  })
})

/**
 * Named for what it actually does. convex-test serializes mutation calls, so
 * this does NOT reproduce an OCC conflict — it pins the observable requirement
 * (one club, one holder) across overlapping callers and nothing more. What holds
 * the concurrent half up is structural, in `claim`: it reads the club row it
 * then patches, so two claims on one club overlap read and write sets and
 * Convex's serializable OCC conflicts the loser — whose retry re-reads a club
 * the seed owner no longer holds and refuses. Same discipline as the duel's
 * ordinal (SAN-20) and the provisioning upsert (SAN-55). Proving it needs an
 * integration test against a local backend, which this repo does not have.
 */
describe('claiming a club — two callers at once', () => {
  it('cannot give one club to two overlapping callers', async () => {
    const { t, away } = await seeded()
    await provision(t, FIRST)
    await provision(t, SECOND)

    const results = await Promise.allSettled([claim(t, away, FIRST), claim(t, away, SECOND)])

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    expect(await holds(t, away, FIRST)).not.toBe(await holds(t, away, SECOND))
  })

  it('cannot give one caller two clubs from overlapping claims', async () => {
    const { t, home, away } = await seeded()
    await provision(t, FIRST)

    const results = await Promise.allSettled([claim(t, away, FIRST), claim(t, home, FIRST)])

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    expect(await holds(t, away, FIRST)).not.toBe(await holds(t, home, FIRST))
  })
})
