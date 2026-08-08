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
 * Compile-time guard for the "no client reach" rule: both seed mutations are
 * `internalMutation`s, so the generated public `api` must not carry a `seed`
 * module at all. Downgrade either one to a plain `mutation` and `api` gains the
 * key, this type resolves to `never`, and `pnpm typecheck` fails.
 */
type SeedStaysInternal = 'seed' extends keyof typeof api ? never : true
const _seedStaysInternal: SeedStaysInternal = true
void _seedStaysInternal

const SEED_IDENTITY = { subject: SEED_CLERK_SUBJECT }

const NON_PITCHER_POSITIONS = ['1B', '2B', '3B', 'C', 'CF', 'DH', 'LF', 'RF', 'SS']

type HitterAttributes = Extract<Doc<'players'>['attributes'], { power: number }>

const distinct = (ratings: readonly number[]): number => new Set(ratings).size

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

/** Run the seed with the opt-in flag on. Each call is one bootstrap run. */
function runSeed(t: Harness): Promise<Id<'games'>> {
  vi.stubEnv(SEED_ENV_FLAG, 'true')
  return t.mutation(internal.seed.bootstrapDevLeague, {})
}

/** Mint one extra game between two clubs, with the opt-in flag on. */
function runMint(t: Harness, homeTeam: Id<'teams'>, awayTeam: Id<'teams'>): Promise<Id<'games'>> {
  vi.stubEnv(SEED_ENV_FLAG, 'true')
  return t.mutation(internal.seed.mintDevGame, { homeTeam, awayTeam })
}

/**
 * Hand a seeded club to a real signed-in user — what SAN-62 will do for real.
 * Patched directly here because this ticket blocks that one: there is no claim
 * flow to call yet, and the seed's behaviour after a claim is what's under test.
 */
function claimClub(t: Harness, team: Id<'teams'>): Promise<void> {
  return t.run(async (ctx) => {
    const real = await ctx.db.insert('users', {
      clerkSubject: 'user_real_person',
      displayName: 'Real Person',
    })
    await ctx.db.patch(team, { owner: real })
  })
}

/** Count the rows a fork would visibly inflate. */
function census(t: Harness) {
  return t.run(async (ctx) => ({
    teams: (await ctx.db.query('teams').collect()).length,
    players: (await ctx.db.query('players').collect()).length,
    games: (await ctx.db.query('games').collect()).length,
    lineups: (await ctx.db.query('lineups').collect()).length,
  }))
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
    await expect(t.mutation(internal.seed.bootstrapDevLeague, {})).rejects.toThrow(SEED_ENV_FLAG)
  })

  it('refuses to run when the flag is set to anything else', async () => {
    const t = harness()
    vi.stubEnv(SEED_ENV_FLAG, '1')
    await expect(t.mutation(internal.seed.bootstrapDevLeague, {})).rejects.toThrow(SEED_ENV_FLAG)
  })

  it('writes nothing when it refuses', async () => {
    const t = harness()
    vi.stubEnv(SEED_ENV_FLAG, undefined)
    await expect(t.mutation(internal.seed.bootstrapDevLeague, {})).rejects.toThrow()

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
      const blocks = side.batters.map(hitterAttributes)
      // Four reads written out rather than looped over a key list: `block[key]`
      // is a Codacy object-injection finding, and a label→accessor table would
      // let the name drift from the field it actually reads. Spelled out, each
      // read sits on its own assertion and the failure names the line.
      expect(distinct(blocks.map((block) => block.power)), 'power').toBeGreaterThanOrEqual(3)
      expect(distinct(blocks.map((block) => block.contact)), 'contact').toBeGreaterThanOrEqual(3)
      expect(distinct(blocks.map((block) => block.speed)), 'speed').toBeGreaterThanOrEqual(3)
      expect(distinct(blocks.map((block) => block.eye)), 'eye').toBeGreaterThanOrEqual(3)
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

/**
 * The seed identifies its clubs by owner + name, both of which the product is
 * free to change. It cannot follow a club that moves, so it must not pretend
 * otherwise: every run re-checks that assumption and refuses rather than
 * silently minting a duplicate club and a second roster.
 */
describe('dev seed — when a club moves out from under it', () => {
  it('refuses to re-run once a club has been adopted by a real user', async () => {
    const t = harness()
    const first = await runSeed(t)
    const row = await t.run((ctx) => ctx.db.get(first))
    if (!row) throw new Error('first seeded game vanished')

    // What AC 9 permits: re-point a seeded club at a real signed-in user.
    await claimClub(t, row.awayTeam)

    await expect(runSeed(t)).rejects.toThrow(/expected either none or exactly/)
    // The refusal is the whole point: no duplicate club, no second roster.
    expect(await census(t)).toEqual({ teams: 2, players: 20, games: 1, lineups: 2 })
  })

  it('refuses to re-run once a club has been renamed', async () => {
    const t = harness()
    const first = await runSeed(t)
    const row = await t.run((ctx) => ctx.db.get(first))
    if (!row) throw new Error('first seeded game vanished')

    await t.run((ctx) => ctx.db.patch(row.homeTeam, { name: 'Renamed By Its Owner' }))

    await expect(runSeed(t)).rejects.toThrow(/expected either none or exactly/)
    expect(await census(t)).toEqual({ teams: 2, players: 20, games: 1, lineups: 2 })
  })

  it('names the clubs it actually found, so the message is diagnosable', async () => {
    const t = harness()
    const first = await runSeed(t)
    const row = await t.run((ctx) => ctx.db.get(first))
    if (!row) throw new Error('first seeded game vanished')

    await t.run((ctx) => ctx.db.patch(row.homeTeam, { name: 'Renamed By Its Owner' }))

    await expect(runSeed(t)).rejects.toThrow(/Renamed By Its Owner/)
  })
})

describe('minting an extra game — the environment gate', () => {
  it('refuses to mint when the opt-in flag is absent', async () => {
    const t = harness()
    const first = await runSeed(t)
    const row = await t.run((ctx) => ctx.db.get(first))
    if (!row) throw new Error('bootstrapped game vanished')

    vi.stubEnv(SEED_ENV_FLAG, undefined)
    await expect(
      t.mutation(internal.seed.mintDevGame, { homeTeam: row.homeTeam, awayTeam: row.awayTeam }),
    ).rejects.toThrow(SEED_ENV_FLAG)
    expect(await census(t)).toEqual({ teams: 2, players: 20, games: 1, lineups: 2 })
  })
})

/**
 * The whole point of the split: minting a game needs two team ids and nothing
 * else, so a club leaving the seed owner — which is what claiming *is* — cannot
 * take the fixture down with it. Bootstrap still refuses after a claim (above);
 * this is the path that replaces it.
 */
describe('minting an extra game — after a club has been claimed', () => {
  it('mints for clubs the seed owner no longer holds', async () => {
    const t = harness()
    const first = await runSeed(t)
    const row = await t.run((ctx) => ctx.db.get(first))
    if (!row) throw new Error('bootstrapped game vanished')
    await claimClub(t, row.awayTeam)

    const second = await runMint(t, row.homeTeam, row.awayTeam)

    expect(second).not.toBe(first)
    expect(await t.run((ctx) => ctx.db.get(second))).toMatchObject({
      status: 'scheduled',
      homeTeam: row.homeTeam,
      awayTeam: row.awayTeam,
    })
    // No fork: the same two clubs and the same twenty players, one more game.
    expect(await census(t)).toEqual({ teams: 2, players: 20, games: 2, lineups: 4 })
  })

  it('fields the same players the bootstrap game did', async () => {
    const t = harness()
    const first = await runSeed(t)
    const row = await t.run((ctx) => ctx.db.get(first))
    if (!row) throw new Error('bootstrapped game vanished')
    const before = await roster(t, first, row.homeTeam)
    await claimClub(t, row.awayTeam)

    const second = await runMint(t, row.homeTeam, row.awayTeam)

    const after = await roster(t, second, row.homeTeam)
    expect(after.battingOrder).toEqual(before.battingOrder)
    expect(after.pitcher._id).toEqual(before.pitcher._id)
  })

  it('leaves ownership exactly as it found it', async () => {
    const t = harness()
    const first = await runSeed(t)
    const row = await t.run((ctx) => ctx.db.get(first))
    if (!row) throw new Error('bootstrapped game vanished')
    await claimClub(t, row.awayTeam)
    const owners = await t.run(async (ctx) => {
      const teams = await ctx.db.query('teams').collect()
      return teams.map((team) => `${team.name}:${team.owner}`).sort()
    })

    await runMint(t, row.homeTeam, row.awayTeam)

    expect(
      await t.run(async (ctx) => {
        const teams = await ctx.db.query('teams').collect()
        return teams.map((team) => `${team.name}:${team.owner}`).sort()
      }),
    ).toEqual(owners)
  })

  it('mints repeatedly, so a claimed league keeps producing games', async () => {
    const t = harness()
    const first = await runSeed(t)
    const row = await t.run((ctx) => ctx.db.get(first))
    if (!row) throw new Error('bootstrapped game vanished')
    await claimClub(t, row.awayTeam)

    await runMint(t, row.homeTeam, row.awayTeam)
    await runMint(t, row.homeTeam, row.awayTeam)

    expect(await census(t)).toEqual({ teams: 2, players: 20, games: 3, lineups: 6 })
  })
})

/**
 * A club's players exist by the time this path is reachable, so a rosterless
 * club means the caller passed the wrong id. Inventing a roster on the spot
 * would be the same silent fork `assertClubsIntact` refuses to make.
 */
describe('minting an extra game — a club with no roster', () => {
  it('refuses rather than minting a second roster', async () => {
    const t = harness()
    const first = await runSeed(t)
    const row = await t.run((ctx) => ctx.db.get(first))
    if (!row) throw new Error('bootstrapped game vanished')
    const owner = (await t.run((ctx) => ctx.db.get(row.homeTeam)))?.owner
    if (!owner) throw new Error('seeded club has no owner')
    const stranger = await t.run((ctx) => ctx.db.insert('teams', { owner, name: 'No Roster' }))

    await expect(runMint(t, row.homeTeam, stranger)).rejects.toThrow(/no roster/i)
  })

  it('writes nothing when it refuses', async () => {
    const t = harness()
    const first = await runSeed(t)
    const row = await t.run((ctx) => ctx.db.get(first))
    if (!row) throw new Error('bootstrapped game vanished')
    const owner = (await t.run((ctx) => ctx.db.get(row.homeTeam)))?.owner
    if (!owner) throw new Error('seeded club has no owner')
    const stranger = await t.run((ctx) => ctx.db.insert('teams', { owner, name: 'No Roster' }))

    await expect(runMint(t, row.homeTeam, stranger)).rejects.toThrow()

    // The bootstrap's rows, plus the bare club this test added — nothing else.
    expect(await census(t)).toEqual({ teams: 3, players: 20, games: 1, lineups: 2 })
  })
})
