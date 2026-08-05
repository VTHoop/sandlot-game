// @vitest-environment edge-runtime
/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { api, internal } from './_generated/api'
import type { Doc, Id } from './_generated/dataModel'
import schema from './schema'
import { SEED_CLERK_SUBJECT, SEED_ENV_FLAG } from './seed'

// convex-test discovers the function modules; exclude the test files themselves.
const modules = import.meta.glob(['./**/*.ts', '!./**/*.test.ts'])

/**
 * Compile-time guard for the "no client reach" rule: `seedDevGame` is an
 * `internalMutation`, so the generated public `api` must not carry a `seed`
 * module at all. Downgrade it to a plain `mutation` and `api` gains the key,
 * this type resolves to `never`, and `pnpm typecheck` fails.
 */
type SeedStaysInternal = 'seed' extends keyof typeof api ? never : true
const _seedStaysInternal: SeedStaysInternal = true
void _seedStaysInternal

const SEED_IDENTITY = { subject: SEED_CLERK_SUBJECT }

const NON_PITCHER_POSITIONS = ['1B', '2B', '3B', 'C', 'CF', 'DH', 'LF', 'RF', 'SS']

type HitterAttributes = Extract<Doc<'players'>['attributes'], { power: number }>

/**
 * The four hitter ratings, each read by a named accessor paired with its label.
 * Deliberately not `block[key]` over a key list: computed member access is a
 * Codacy object-injection finding, and the accessor stays type-checked against
 * the block where a string key would not. Same reason `src/design/duel/roster.ts`
 * reaches for a Map rather than a record.
 */
const HITTER_ATTRIBUTES = [
  ['power', (block: HitterAttributes) => block.power],
  ['contact', (block: HitterAttributes) => block.contact],
  ['speed', (block: HitterAttributes) => block.speed],
  ['eye', (block: HitterAttributes) => block.eye],
] as const

/** Narrow a player's attribute union to the hitter block its role promises. */
function hitterAttributes(player: Doc<'players'>): HitterAttributes {
  const block = player.attributes
  if (!('power' in block)) throw new Error(`${player.name} is not carrying a hitter block`)
  return block
}

function harness() {
  return convexTest(schema, modules)
}

type Harness = ReturnType<typeof harness>

/** Run the seed with the opt-in flag on. Each call is one `seedDevGame` run. */
function runSeed(t: Harness): Promise<Id<'games'>> {
  vi.stubEnv(SEED_ENV_FLAG, 'true')
  return t.mutation(internal.seed.seedDevGame, {})
}

interface Roster {
  battingOrder: Doc<'lineups'>['battingOrder']
  batters: Doc<'players'>[]
  pitcher: Doc<'players'>
}

/** The lineup a game holds for one team, resolved to the player rows behind it. */
function roster(t: Harness, game: Id<'games'>, team: Id<'teams'>): Promise<Roster> {
  return t.run(async (ctx) => {
    const lineups = await ctx.db
      .query('lineups')
      .withIndex('by_game', (q) => q.eq('game', game))
      .collect()
    const lineup = lineups.find((l) => l.team === team)
    if (!lineup) throw new Error('seeded game is missing a lineup')
    const batters = await Promise.all(lineup.battingOrder.map((slot) => ctx.db.get(slot.player)))
    const pitcher = await ctx.db.get(lineup.pitcher)
    if (!pitcher || batters.some((b) => b === null)) throw new Error('lineup references a ghost')
    return { battingOrder: lineup.battingOrder, batters: batters as Doc<'players'>[], pitcher }
  })
}

/** Seed once and resolve both sides — the shape most assertions below need. */
async function seeded() {
  const t = harness()
  const game = await runSeed(t)
  const row = await t.run((ctx) => ctx.db.get(game))
  if (!row) throw new Error('seed returned an id with no game behind it')
  return {
    t,
    game,
    row,
    home: await roster(t, game, row.homeTeam),
    away: await roster(t, game, row.awayTeam),
  }
}

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('dev seed — the environment gate', () => {
  it('refuses to run when the opt-in flag is absent', async () => {
    const t = harness()
    vi.stubEnv(SEED_ENV_FLAG, undefined)
    await expect(t.mutation(internal.seed.seedDevGame, {})).rejects.toThrow(SEED_ENV_FLAG)
  })

  it('refuses to run when the flag is set to anything else', async () => {
    const t = harness()
    vi.stubEnv(SEED_ENV_FLAG, '1')
    await expect(t.mutation(internal.seed.seedDevGame, {})).rejects.toThrow(SEED_ENV_FLAG)
  })

  it('writes nothing when it refuses', async () => {
    const t = harness()
    vi.stubEnv(SEED_ENV_FLAG, undefined)
    await expect(t.mutation(internal.seed.seedDevGame, {})).rejects.toThrow()

    const rows = await t.run(async (ctx) => ({
      users: await ctx.db.query('users').collect(),
      teams: await ctx.db.query('teams').collect(),
      players: await ctx.db.query('players').collect(),
      games: await ctx.db.query('games').collect(),
      lineups: await ctx.db.query('lineups').collect(),
    }))
    expect(Object.values(rows).every((table) => table.length === 0)).toBe(true)
  })
})

describe('dev seed — what one run creates', () => {
  it('creates one synthetic user owning both teams', async () => {
    const { t, row } = await seeded()

    const users = await t.run((ctx) => ctx.db.query('users').collect())
    expect(users).toHaveLength(1)
    expect(users[0].clerkSubject).toBe(SEED_CLERK_SUBJECT)

    const teams = await t.run((ctx) => ctx.db.query('teams').collect())
    expect(teams).toHaveLength(2)
    expect(teams.every((team) => team.owner === users[0]._id)).toBe(true)
    expect(new Set(teams.map((team) => team._id))).toEqual(new Set([row.homeTeam, row.awayTeam]))
  })

  it('returns the id of a scheduled game with coherent pre-start state', async () => {
    const { row } = await seeded()
    expect(row).toMatchObject({
      status: 'scheduled',
      inning: 1,
      half: 'top',
      outs: 0,
      bases: { first: null, second: null, third: null },
      homeScore: 0,
      awayScore: 0,
      currentBatter: null,
      currentPitcher: null,
      homeBattingIndex: 0,
      awayBattingIndex: 0,
      lastResolvedSequence: -1,
    })
  })

  it('gives each team ten players — nine distinct positions plus a pitcher', async () => {
    const { t, home, away } = await seeded()
    expect(await t.run((ctx) => ctx.db.query('players').collect())).toHaveLength(20)

    for (const side of [home, away]) {
      expect(side.battingOrder).toHaveLength(9)
      expect(side.battingOrder.map((slot) => slot.position).sort()).toEqual(NON_PITCHER_POSITIONS)
      expect(side.batters.every((batter) => batter.role === 'hitter')).toBe(true)
      // The slot's position is the player's own — a lineup never re-positions a player.
      expect(side.batters.map((batter) => batter.position)).toEqual(
        side.battingOrder.map((slot) => slot.position),
      )

      expect(side.pitcher.role).toBe('pitcher')
      expect(side.pitcher.position).toBe('P')
      expect(side.batters.some((batter) => batter._id === side.pitcher._id)).toBe(false)
    }
  })

  it('invents every player rather than importing one', async () => {
    const { t } = await seeded()
    const players = await t.run((ctx) => ctx.db.query('players').collect())
    expect(players.every((player) => player.source === 'custom')).toBe(true)
  })

  it('spreads each hitter attribute across at least three ratings', async () => {
    const { home, away } = await seeded()
    for (const side of [home, away]) {
      for (const [label, read] of HITTER_ATTRIBUTES) {
        const ratings = side.batters.map((batter) => read(hitterAttributes(batter)))
        expect(new Set(ratings).size, `${label} spread`).toBeGreaterThanOrEqual(3)
      }
    }
  })

  it('gives the two pitchers different attribute blocks', async () => {
    const { home, away } = await seeded()
    expect(home.pitcher.attributes).not.toEqual(away.pitcher.attributes)
  })

  it('writes no rollup rows — those belong to their own tickets', async () => {
    const { t } = await seeded()
    const rollups = await t.run(async (ctx) => ({
      standings: await ctx.db.query('standings').collect(),
      playerStatLine: await ctx.db.query('playerStatLine').collect(),
      boxScoreLine: await ctx.db.query('boxScoreLine').collect(),
    }))
    expect(Object.values(rollups).every((table) => table.length === 0)).toBe(true)
  })
})

describe('dev seed — the game it produces is immediately startable', () => {
  it('goes live with the away leadoff facing the home pitcher', async () => {
    const { t, game, home, away } = await seeded()
    await t.withIdentity(SEED_IDENTITY).mutation(api.game.startGame, { game })

    expect(await t.run((ctx) => ctx.db.get(game))).toMatchObject({
      status: 'live',
      inning: 1,
      half: 'top',
      currentBatter: away.batters[0]._id,
      currentPitcher: home.pitcher._id,
    })
  })
})

describe('dev seed — re-running', () => {
  it('appends a fresh game and lineups while reusing the user, teams, and players', async () => {
    const t = harness()
    const first = await runSeed(t)
    const second = await runSeed(t)
    expect(second).not.toBe(first)

    const counts = await t.run(async (ctx) => ({
      users: (await ctx.db.query('users').collect()).length,
      teams: (await ctx.db.query('teams').collect()).length,
      players: (await ctx.db.query('players').collect()).length,
      games: (await ctx.db.query('games').collect()).length,
      lineups: (await ctx.db.query('lineups').collect()).length,
    }))
    expect(counts).toEqual({ users: 1, teams: 2, players: 20, games: 2, lineups: 4 })
  })

  it('leaves the earlier game and its lineups untouched', async () => {
    const t = harness()
    const first = await runSeed(t)
    const before = await t.run((ctx) => ctx.db.get(first))
    if (!before) throw new Error('first seeded game vanished')
    const firstHome = await roster(t, first, before.homeTeam)

    await runSeed(t)

    expect(await t.run((ctx) => ctx.db.get(first))).toEqual(before)
    expect((await roster(t, first, before.homeTeam)).battingOrder).toEqual(firstHome.battingOrder)
  })

  it('fields the same players on both runs', async () => {
    const t = harness()
    const first = await runSeed(t)
    const firstRow = await t.run((ctx) => ctx.db.get(first))
    if (!firstRow) throw new Error('first seeded game vanished')
    const second = await runSeed(t)

    const before = await roster(t, first, firstRow.homeTeam)
    const after = await roster(t, second, firstRow.homeTeam)
    expect(after.battingOrder).toEqual(before.battingOrder)
    expect(after.pitcher._id).toEqual(before.pitcher._id)
  })
})
