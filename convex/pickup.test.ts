// @vitest-environment edge-runtime
/// <reference types="vite/client" />

import { convexTest } from 'convex-test'
import { describe, expect, it } from 'vitest'
import { api } from './_generated/api'
import type { Doc, Id } from './_generated/dataModel'
import { createGameBetween } from './pickup'
import schema from './schema'
import { HITTER_SLOT_LIST } from './seasonPlayers'

/**
 * Pickup games (SAN-78). Every team and player is fictional — no real names or
 * stats (ADR-0006).
 */

const modules = import.meta.glob(['./**/*.ts', '!./**/*.test.ts'])

const KID = { subject: 'kid' }
const HOME = 'Prairie Owls'
const AWAY = 'Dune Foxes'

type NewPlayer = Omit<Doc<'players'>, '_id' | '_creationTime'>

let nextId = 1
const fullTeam = (mlbTeam: string): NewPlayer[] => [
  ...HITTER_SLOT_LIST.map((position) => ({
    name: `Hitter ${nextId}`,
    source: 'mlb' as const,
    role: 'hitter' as const,
    position,
    price: null,
    attributes: { power: 3, contact: 3, speed: 3, eye: 3 } as const,
    mlbId: nextId++,
    mlbTeam,
    plateAppearances: 500,
  })),
  {
    name: `Arm ${nextId}`,
    source: 'mlb',
    role: 'pitcher',
    position: 'P',
    price: null,
    attributes: { velocity: 3, movement: 3, awareness: 3, command: 3 },
    mlbId: nextId++,
    mlbTeam,
    outs: 400,
  },
]

async function seeded() {
  const t = convexTest(schema, modules)
  const user = await t.run(async (ctx) => {
    const id = await ctx.db.insert('users', { clerkSubject: KID.subject, displayName: 'kid' })
    for (const player of [...fullTeam(HOME), ...fullTeam(AWAY)]) {
      await ctx.db.insert('players', player)
    }
    return id
  })
  return { t, user, kid: t.withIdentity(KID) }
}

const counts = (t: Awaited<ReturnType<typeof seeded>>['t']) =>
  t.run(async (ctx) => ({
    teams: (await ctx.db.query('teams').collect()).length,
    games: (await ctx.db.query('games').collect()).length,
    lineups: (await ctx.db.query('lineups').collect()).length,
  }))

describe('pickup.createPickupGame', () => {
  it('makes a scheduled game with a lineup a side, managed on both sides by the caller', async () => {
    const { t, user, kid } = await seeded()
    const id = await kid.mutation(api.pickup.createPickupGame, { homeTeam: HOME, awayTeam: AWAY })
    const game = await t.run((ctx) => ctx.db.get(id))
    const lineups = await t.run((ctx) =>
      ctx.db
        .query('lineups')
        .withIndex('by_game', (q) => q.eq('game', id))
        .collect(),
    )
    expect(game).toMatchObject({
      status: 'scheduled',
      homeManager: { kind: 'user', user },
      awayManager: { kind: 'user', user },
    })
    expect(lineups.map((l) => l.team).sort()).toEqual([game?.homeTeam, game?.awayTeam].sort())
    for (const lineup of lineups) expect(lineup.battingOrder).toHaveLength(9)
  })

  it('makes a game the existing startGame can open', async () => {
    const { t, kid } = await seeded()
    const id = await kid.mutation(api.pickup.createPickupGame, { homeTeam: HOME, awayTeam: AWAY })
    await kid.mutation(api.game.startGame, { game: id })
    expect((await t.run((ctx) => ctx.db.get(id)))?.status).toBe('live')
  })

  it('marks the game as a pickup game', async () => {
    const { t, kid } = await seeded()
    const id = await kid.mutation(api.pickup.createPickupGame, { homeTeam: HOME, awayTeam: AWAY })
    expect(await t.run((ctx) => ctx.db.get(id))).toMatchObject({ pickup: true })
  })

  it('creates an ownerless teams row on first pick and reuses it on later picks', async () => {
    const { t, kid } = await seeded()
    await kid.mutation(api.pickup.createPickupGame, { homeTeam: HOME, awayTeam: AWAY })
    const first = await t.run((ctx) => ctx.db.query('teams').collect())
    expect(first.map((team) => team.name).sort()).toEqual([AWAY, HOME])
    for (const team of first) expect(team).not.toHaveProperty('owner')

    await kid.mutation(api.pickup.createPickupGame, { homeTeam: AWAY, awayTeam: HOME })
    expect(await t.run((ctx) => ctx.db.query('teams').collect())).toEqual(first)
  })

  it('refuses the same team on both sides, and writes nothing', async () => {
    const { t, kid } = await seeded()
    await expect(
      kid.mutation(api.pickup.createPickupGame, { homeTeam: HOME, awayTeam: HOME }),
    ).rejects.toThrow(/same team/i)
    expect(await counts(t)).toEqual({ teams: 0, games: 0, lineups: 0 })
  })

  it('refuses a team listMlbTeams does not offer, and writes nothing', async () => {
    const { t, kid } = await seeded()
    await expect(
      kid.mutation(api.pickup.createPickupGame, { homeTeam: HOME, awayTeam: 'Nowhere Nine' }),
    ).rejects.toThrow(/Nowhere Nine/)
    expect(await counts(t)).toEqual({ teams: 0, games: 0, lineups: 0 })
  })

  it('validates both lineups before writing any teams row (bad home side, valid away side)', async () => {
    const { t, kid } = await seeded()
    await expect(
      kid.mutation(api.pickup.createPickupGame, { homeTeam: 'Nowhere Nine', awayTeam: HOME }),
    ).rejects.toThrow()
    expect(await counts(t)).toEqual({ teams: 0, games: 0, lineups: 0 })
  })

  it('refuses an unauthenticated caller, and writes nothing', async () => {
    const { t } = await seeded()
    await expect(
      t.mutation(api.pickup.createPickupGame, { homeTeam: HOME, awayTeam: AWAY }),
    ).rejects.toThrow(/Not authenticated/)
    expect(await counts(t)).toEqual({ teams: 0, games: 0, lineups: 0 })
  })

  it('refuses an identity that has no users row', async () => {
    const { t } = await seeded()
    await expect(
      t
        .withIdentity({ subject: 'stranger' })
        .mutation(api.pickup.createPickupGame, { homeTeam: HOME, awayTeam: AWAY }),
    ).rejects.toThrow(/Not authenticated/)
  })
})

// ─── The shared creation core (SAN-84) ──────────────────────────────────────

type Seeded = Awaited<ReturnType<typeof seeded>>
type Manager = NonNullable<Doc<'games'>['homeManager']>

const asUser = (user: Id<'users'>): Manager => ({ kind: 'user', user })
const BOT: Manager = { kind: 'bot' }

/** The helper, run the way a mutation would: no sign-in anywhere in sight. */
function create(
  t: Seeded['t'],
  sides: { homeManager: Manager; awayManager: Manager; homeTeam?: string; awayTeam?: string },
) {
  return t.run((ctx) => createGameBetween(ctx, { homeTeam: HOME, awayTeam: AWAY, ...sides }))
}

const SECOND = { subject: 'sibling' }
async function twoManagers() {
  const base = await seeded()
  const sibling = await base.t.run((ctx) =>
    ctx.db.insert('users', { clerkSubject: SECOND.subject, displayName: 'sibling' }),
  )
  return { ...base, sibling, siblingClient: base.t.withIdentity(SECOND) }
}

describe('createGameBetween', () => {
  const PAIRINGS: [string, (user: Id<'users'>, sibling: Id<'users'>) => [Manager, Manager]][] = [
    ['two different users', (user, sibling) => [asUser(user), asUser(sibling)]],
    ['a user at home and the bot away', (user) => [asUser(user), BOT]],
    ['the bot at home and a user away', (user) => [BOT, asUser(user)]],
  ]

  it.each(PAIRINGS)('records the managers it is given: %s', async (_label, pairing) => {
    const { t, user, sibling } = await twoManagers()
    const [homeManager, awayManager] = pairing(user, sibling)
    const id = await create(t, { homeManager, awayManager })
    expect(await t.run((ctx) => ctx.db.get(id))).toMatchObject({ homeManager, awayManager })
  })

  it('accepts one user on both sides (hotseat)', async () => {
    const { t, user } = await seeded()
    const id = await create(t, { homeManager: asUser(user), awayManager: asUser(user) })
    expect(await t.run((ctx) => ctx.db.get(id))).toMatchObject({
      homeManager: asUser(user),
      awayManager: asUser(user),
    })
  })

  it('does no sign-in: it creates a scheduled game with no caller at all', async () => {
    const { t, user } = await seeded()
    const id = await create(t, { homeManager: asUser(user), awayManager: BOT })
    expect(await t.run((ctx) => ctx.db.get(id))).toMatchObject({
      status: 'scheduled',
      pickup: true,
    })
  })

  it.each([
    [
      'home',
      (user: Id<'users'>, gone: Id<'users'>): [Manager, Manager] => [asUser(gone), asUser(user)],
    ],
    [
      'away',
      (user: Id<'users'>, gone: Id<'users'>): [Manager, Manager] => [asUser(user), asUser(gone)],
    ],
  ])('refuses a %s user manager that does not exist, and writes nothing', async (side, pairing) => {
    const { t, user } = await seeded()
    const gone = await t.run(async (ctx) => {
      const id = await ctx.db.insert('users', { clerkSubject: 'gone', displayName: 'gone' })
      await ctx.db.delete(id)
      return id
    })
    const [homeManager, awayManager] = pairing(user, gone)
    await expect(create(t, { homeManager, awayManager })).rejects.toThrow(
      new RegExp(`The ${side} manager does not exist`),
    )
    expect(await counts(t)).toEqual({ teams: 0, games: 0, lineups: 0 })
  })

  it('refuses the same team on both sides, and writes nothing', async () => {
    const { t, user } = await seeded()
    await expect(
      create(t, { homeManager: asUser(user), awayManager: asUser(user), awayTeam: HOME }),
    ).rejects.toThrow(/same team/i)
    expect(await counts(t)).toEqual({ teams: 0, games: 0, lineups: 0 })
  })

  it('refuses a team that cannot field a lineup, and writes nothing', async () => {
    const { t, user } = await seeded()
    await expect(
      create(t, { homeManager: asUser(user), awayManager: BOT, awayTeam: 'Nowhere Nine' }),
    ).rejects.toThrow(/Nowhere Nine/)
    expect(await counts(t)).toEqual({ teams: 0, games: 0, lineups: 0 })
  })

  it('refuses the bot managing both sides, and writes nothing', async () => {
    const { t } = await seeded()
    await expect(create(t, { homeManager: BOT, awayManager: BOT })).rejects.toThrow(
      /bot.*both sides/i,
    )
    expect(await counts(t)).toEqual({ teams: 0, games: 0, lineups: 0 })
  })
})

// ─── The secret-pitch contract across two managers (SAN-84) ─────────────────

/** Whether `number` appears as a value anywhere in a response. */
function holds(value: unknown, number: number): boolean {
  if (value === number) return true
  if (Array.isArray(value)) return value.some((item) => holds(item, number))
  if (value !== null && typeof value === 'object') {
    return Object.values(value).some((item) => holds(item, number))
  }
  return false
}

/** A started game: the first user manages home (pitches, top half), the sibling away (bats). */
async function startedDuel() {
  const setup = await twoManagers()
  const id = await create(setup.t, {
    homeManager: asUser(setup.user),
    awayManager: asUser(setup.sibling),
  })
  await setup.kid.mutation(api.game.startGame, { game: id })
  return { ...setup, id }
}

/** The seat gate's refusal (`requireCommittableGame`), so an unrelated throw can't pass for it. */
const NOT_YOUR_SIDE = 'Not authorized for this team'

describe('a game between two different users keeps the pitch secret', () => {
  it('lets each user commit only for their own side', async () => {
    const { kid, siblingClient, id } = await startedDuel()
    await expect(
      siblingClient.mutation(api.atBat.commitPitch, { game: id, number: 5 }),
    ).rejects.toThrow(NOT_YOUR_SIDE)
    await expect(kid.mutation(api.atBat.commitSwing, { game: id, number: 5 })).rejects.toThrow(
      NOT_YOUR_SIDE,
    )
    await expect(
      kid.mutation(api.atBat.commitPitch, { game: id, number: 5 }),
    ).resolves.not.toThrow()
    await expect(
      siblingClient.mutation(api.atBat.commitSwing, { game: id, number: 6 }),
    ).resolves.not.toThrow()
  })

  it.each([
    ['the pitcher locks first', 777, 'pitch'],
    ['the batter locks first', 313, 'swing'],
  ] as const)('shows the other user no number when %s', async (_label, number, seat) => {
    const { kid, siblingClient, id } = await startedDuel()
    const [committer, reader] = seat === 'pitch' ? [kid, siblingClient] : [siblingClient, kid]
    await committer.mutation(seat === 'pitch' ? api.atBat.commitPitch : api.atBat.commitSwing, {
      game: id,
      number,
    })

    const duel = await reader.query(api.atBat.getActiveDuel, { game: id })
    expect(duel).toEqual({
      status: 'awaiting_opponent',
      sequence: 0,
      pitchCommitted: seat === 'pitch',
      swingCommitted: seat === 'swing',
    })
    const reads = [
      duel,
      await reader.query(api.gameView.getGame, { game: id }),
      await reader.query(api.atBatView.getLastAtBat, { game: id }),
      await reader.query(api.myGames.listMyGames, {}),
    ]
    for (const read of reads) expect(holds(read, number)).toBe(false)
  })
})
