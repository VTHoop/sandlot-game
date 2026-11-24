// @vitest-environment edge-runtime
/// <reference types="vite/client" />

import { convexTest } from 'convex-test'
import { describe, expect, it } from 'vitest'
import { api } from './_generated/api'
import type { Doc } from './_generated/dataModel'
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

  it('writes no teams row for a valid side when the other side fails', async () => {
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
