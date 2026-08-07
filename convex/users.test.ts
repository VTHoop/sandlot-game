// @vitest-environment edge-runtime
/// <reference types="vite/client" />

import type { FunctionArgs } from 'convex/server'
import { convexTest } from 'convex-test'
import { describe, expect, it } from 'vitest'
import { api } from './_generated/api'
import type { Doc, Id } from './_generated/dataModel'
import { authedUser, maybeUser } from './participants'
import schema from './schema'
import { SEED_CLERK_SUBJECT } from './seed'

// convex-test discovers the function modules; exclude the test files themselves.
const modules = import.meta.glob(['./**/*.ts', '!./**/*.test.ts'])

/**
 * Compile-time guard for "a caller cannot provision a subject other than its
 * own": `provision` takes no arguments at all, so the subject can only come from
 * `ctx.auth`. Give it one and this type resolves to `never` and `pnpm typecheck`
 * fails.
 */
type ProvisionTakesNoArgs = [keyof FunctionArgs<typeof api.users.provision>] extends [never]
  ? true
  : never
const _provisionTakesNoArgs: ProvisionTakesNoArgs = true
void _provisionTakesNoArgs

function harness() {
  return convexTest(schema, modules)
}

type Harness = ReturnType<typeof harness>

function users(t: Harness): Promise<Doc<'users'>[]> {
  return t.run((ctx) => ctx.db.query('users').collect())
}

/** The one row a single provisioned caller is expected to have produced. */
async function soleUser(t: Harness): Promise<Doc<'users'>> {
  const rows = await users(t)
  expect(rows).toHaveLength(1)
  return rows[0]
}

/** The dev fixture's world, minus the roster: its owner row, two clubs, a game. */
function seedFixture(t: Harness): Promise<Id<'games'>> {
  return t.run(async (ctx) => {
    const owner = await ctx.db.insert('users', {
      clerkSubject: SEED_CLERK_SUBJECT,
      displayName: 'Sandlot Dev',
    })
    const homeTeam = await ctx.db.insert('teams', { owner, name: 'Home' })
    const awayTeam = await ctx.db.insert('teams', { owner, name: 'Away' })
    return ctx.db.insert('games', {
      homeTeam,
      awayTeam,
      inning: 1,
      half: 'top',
      outs: 0,
      bases: { first: null, second: null, third: null },
      homeScore: 0,
      awayScore: 0,
      status: 'scheduled',
      currentBatter: null,
      currentPitcher: null,
      homeBattingIndex: 0,
      awayBattingIndex: 0,
      lastResolvedSequence: -1,
    })
  })
}

describe('provision — who may call it', () => {
  it('refuses an unauthenticated caller', async () => {
    const t = harness()
    await expect(t.mutation(api.users.provision, {})).rejects.toThrow(/Not authenticated/)
  })

  it('writes nothing when it refuses', async () => {
    const t = harness()
    await expect(t.mutation(api.users.provision, {})).rejects.toThrow()
    expect(await users(t)).toHaveLength(0)
  })

  it('keys the row on the caller’s own Clerk subject', async () => {
    const t = harness()
    const id = await t.withIdentity({ subject: 'user_2abc' }).mutation(api.users.provision, {})

    const row = await soleUser(t)
    expect(row._id).toBe(id)
    expect(row.clerkSubject).toBe('user_2abc')
  })
})

/**
 * Every rung is exercised with the rungs above it absent, because a missing
 * claim fails silently by falling through — a JWT template that stopped sending
 * `name` would otherwise degrade with nothing turning red.
 */
describe('provision — the displayName fallback chain', () => {
  async function nameFor(identity: Record<string, string>): Promise<string> {
    const t = harness()
    await t.withIdentity(identity).mutation(api.users.provision, {})
    return (await soleUser(t)).displayName
  }

  it('takes the full name first', async () => {
    const name = await nameFor({
      subject: 'user_full',
      name: 'Casey Jones',
      nickname: 'slugger',
      email: 'casey@example.com',
    })
    expect(name).toBe('Casey Jones')
  })

  it('falls back to the username when there is no full name', async () => {
    // Clerk's `convex` JWT template maps `nickname` to the account's username.
    const name = await nameFor({
      subject: 'user_nick',
      nickname: 'slugger',
      email: 'casey@example.com',
    })
    expect(name).toBe('slugger')
  })

  it('falls back to the email local-part when there is no username', async () => {
    expect(await nameFor({ subject: 'user_mail', email: 'ninth.inning@example.com' })).toBe(
      'ninth.inning',
    )
  })

  it('falls back to a generic constant when the identity carries nothing', async () => {
    expect(await nameFor({ subject: 'user_bare' })).toBe('Manager')
  })

  it('treats a blank claim as absent rather than as a name', async () => {
    const name = await nameFor({ subject: 'user_blank', name: '   ', nickname: '', email: ' ' })
    expect(name).toBe('Manager')
  })

  it('treats an email with no local-part as absent', async () => {
    expect(await nameFor({ subject: 'user_atless', email: '@example.com' })).toBe('Manager')
  })

  it('trims the claim it settles on', async () => {
    expect(await nameFor({ subject: 'user_padded', name: '  Casey Jones  ' })).toBe('Casey Jones')
  })
})

describe('provision — calling it again', () => {
  const RETURNING = { subject: 'user_returning', name: 'Casey Jones' }

  it('returns the same row instead of minting a second one', async () => {
    const t = harness()
    const first = await t.withIdentity(RETURNING).mutation(api.users.provision, {})
    const second = await t.withIdentity(RETURNING).mutation(api.users.provision, {})

    expect(second).toBe(first)
    expect(await users(t)).toHaveLength(1)
  })

  it('never re-syncs displayName from Clerk, so a later profile edit survives', async () => {
    const t = harness()
    const id = await t.withIdentity(RETURNING).mutation(api.users.provision, {})
    // Stand in for the in-app profile edit this ticket does not yet expose.
    await t.run((ctx) => ctx.db.patch(id, { displayName: 'Sandlot Legend' }))

    await t
      .withIdentity({ ...RETURNING, name: 'Renamed In Clerk' })
      .mutation(api.users.provision, {})

    expect((await soleUser(t)).displayName).toBe('Sandlot Legend')
  })

  it('cannot produce two rows for one subject from overlapping first-time calls', async () => {
    const t = harness()
    // convex-test executes mutations serially, so this asserts the observable
    // requirement (one subject, one row) rather than reproducing a real race.
    // Safety under genuine concurrency comes from the upsert reading the index
    // range it then inserts into: Convex's serializable OCC conflicts the loser,
    // and the retry sees the committed row (see the module comment in seed.ts).
    const ids = await Promise.all([
      t.withIdentity({ subject: 'user_racer' }).mutation(api.users.provision, {}),
      t.withIdentity({ subject: 'user_racer' }).mutation(api.users.provision, {}),
    ])

    expect(new Set(ids).size).toBe(1)
    expect(await users(t)).toHaveLength(1)
  })

  it('keeps separate subjects on separate rows', async () => {
    const t = harness()
    const one = await t.withIdentity({ subject: 'user_one' }).mutation(api.users.provision, {})
    const two = await t.withIdentity({ subject: 'user_two' }).mutation(api.users.provision, {})

    expect(two).not.toBe(one)
    expect(await users(t)).toHaveLength(2)
  })
})

/**
 * The dev fixture owns a `users` row too (`SEED_CLERK_SUBJECT`). Both sides key
 * on the Clerk subject and the seed's is a shape Clerk cannot issue, so neither
 * can reach the other's row — asserted from both directions, because a collision
 * would silently hand a real player the bot's clubs.
 */
describe('provision — isolation from the dev seed owner', () => {
  it('gives a real caller its own row, leaving the seed owner untouched', async () => {
    const t = harness()
    await seedFixture(t)
    const [seedOwner] = await users(t)

    const id = await t.withIdentity({ subject: 'user_real' }).mutation(api.users.provision, {})

    const rows = await users(t)
    expect(rows).toHaveLength(2)
    expect(rows.find((row) => row.clerkSubject === SEED_CLERK_SUBJECT)).toEqual(seedOwner)
    expect(id).not.toBe(seedOwner._id)
  })

  it('never resolves a provisioned caller onto the seed owner’s row', async () => {
    const t = harness()
    await seedFixture(t)
    const as = t.withIdentity({ subject: 'user_real' })
    await as.mutation(api.users.provision, {})

    expect((await as.run((ctx) => authedUser(ctx))).clerkSubject).toBe('user_real')
  })

  it('claims no club for the caller it provisions', async () => {
    const t = harness()
    await seedFixture(t)
    const id = await t.withIdentity({ subject: 'user_real' }).mutation(api.users.provision, {})

    const teams = await t.run((ctx) => ctx.db.query('teams').collect())
    expect(teams).toHaveLength(2)
    expect(teams.some((team) => team.owner === id)).toBe(false)
  })
})

describe('provision — what it unblocks', () => {
  const CALLER = { subject: 'user_caller', name: 'Casey Jones' }

  it('makes authedUser resolve for a caller it previously rejected', async () => {
    const t = harness()
    const as = t.withIdentity(CALLER)

    await expect(as.run((ctx) => authedUser(ctx))).rejects.toThrow(/Not authenticated/)

    const id = await as.mutation(api.users.provision, {})
    expect((await as.run((ctx) => authedUser(ctx)))._id).toBe(id)
  })

  it('treats an authenticated-but-unprovisioned caller as unauthenticated for reads', async () => {
    const t = harness()
    expect(await t.withIdentity(CALLER).run((ctx) => maybeUser(ctx))).toBeNull()
  })

  it('returns null rather than throwing from a participant-gated query', async () => {
    const t = harness()
    const game = await seedFixture(t)

    expect(await t.withIdentity(CALLER).query(api.atBat.getActiveDuel, { game })).toBeNull()
  })
})
