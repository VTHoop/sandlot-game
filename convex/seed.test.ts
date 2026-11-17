// @vitest-environment edge-runtime
/// <reference types="vite/client" />

import type { FunctionArgs } from 'convex/server'
import { convexTest } from 'convex-test'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { api, internal } from './_generated/api'
import type { Doc, Id } from './_generated/dataModel'
import schema from './schema'
import { type DevGameResult, SEED_CLERK_SUBJECT, SEED_ENV_FLAG } from './seed'

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

/** A real signed-in Clerk account — the kind a seeded club gets handed to. */
const REAL_SUBJECT = 'user_real_person'

/** A second one, for moving a club that a real user already holds. */
const OTHER_SUBJECT = 'user_second_tester'

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

/** Mint a real user's row the one way the app mints one (SAN-55). */
function provision(t: Harness, subject: string): Promise<Id<'users'>> {
  return t.withIdentity({ subject }).mutation(api.users.provision, {})
}

/** Every club as `name:owner`, sorted — the whole ownership picture in one value. */
function ownership(t: Harness): Promise<string[]> {
  return t.run(async (ctx) => {
    const teams = await ctx.db.query('teams').collect()
    return teams.map((team) => `${team.name}:${team.owner}`).sort()
  })
}

/**
 * Hand a seeded club to a real signed-in user, as the product eventually will
 * (the draft, SAN-34): nothing in the seed does it any more (SAN-76), so the test
 * moves `teams.owner` directly.
 */
async function claimClub(t: Harness, team: Id<'teams'>, subject = REAL_SUBJECT): Promise<void> {
  const owner = await provision(t, subject)
  await t.run((ctx) => ctx.db.patch(team, { owner }))
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
    // `every` with an inferred type predicate (TS 5.5) narrows `batters` itself,
    // so the ghost check is also what drops the nulls — no cast to re-assert it.
    if (!pitcher || !batters.every((b) => b !== null)) throw new Error('lineup references a ghost')
    return { battingOrder: lineup.battingOrder, batters, pitcher }
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
    const before = await ownership(t)

    await runMint(t, row.homeTeam, row.awayTeam)

    expect(await ownership(t)).toEqual(before)
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

describe('minting an extra game — a club against itself', () => {
  it('refuses rather than minting a game a club plays against itself', async () => {
    const t = harness()
    const first = await runSeed(t)
    const row = await t.run((ctx) => ctx.db.get(first))
    if (!row) throw new Error('bootstrapped game vanished')

    await expect(runMint(t, row.homeTeam, row.homeTeam)).rejects.toThrow(/itself/i)
    expect(await census(t)).toEqual({ teams: 2, players: 20, games: 1, lineups: 2 })
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

  it('names the bare id when the club row is gone entirely', async () => {
    const t = harness()
    const first = await runSeed(t)
    const row = await t.run((ctx) => ctx.db.get(first))
    if (!row) throw new Error('bootstrapped game vanished')
    const owner = (await t.run((ctx) => ctx.db.get(row.homeTeam)))?.owner
    if (!owner) throw new Error('seeded club has no owner')
    // A stale id in someone's shell history is the likeliest way to reach this.
    const ghost = await t.run((ctx) => ctx.db.insert('teams', { owner, name: 'Deleted' }))
    await t.run((ctx) => ctx.db.delete(ghost))

    // No club to name, so the message falls back to the id it was handed —
    // which is the thing the caller has to go fix.
    await expect(runMint(t, row.homeTeam, ghost)).rejects.toThrow(ghost)
  })
})

type DevGameArgs = FunctionArgs<typeof internal.seed.devGame>
/** The one-step dev game (SAN-66, SAN-71), with the opt-in flag on. */
function runDevGame(t: Harness, args: DevGameArgs = {}): Promise<DevGameResult> {
  vi.stubEnv(SEED_ENV_FLAG, 'true')
  return t.mutation(internal.seed.devGame, args)
}

/** A signed-in account with a full display name, minted the way the app mints one. */
function signIn(t: Harness, subject: string, name: string): Promise<Id<'users'>> {
  return t.withIdentity({ subject, name }).mutation(api.users.provision, {})
}

/** Who manages each side of a game: a users row, or `'bot'`. */
function seating(t: Harness, game: Id<'games'>) {
  return t.run(async (ctx) => {
    const row = await ctx.db.get(game)
    if (!row) throw new Error('dev game returned an id with no game behind it')
    const who = (manager: typeof row.homeManager) =>
      manager?.kind === 'user' ? manager.user : manager?.kind
    return { status: row.status, home: who(row.homeManager), away: who(row.awayManager) }
  })
}

/** The two accounts most tests seat: Sam (the first subject) and Max (the second). */
async function signInSamAndMax(t: Harness) {
  const sam = await signIn(t, REAL_SUBJECT, 'Sam Hooper')
  const max = await signIn(t, OTHER_SUBJECT, 'Max Rivera')
  return { sam, max }
}

describe('dev game in one step — the environment gate', () => {
  it('refuses when the opt-in flag is absent, writing nothing', async () => {
    const t = harness()
    await provision(t, REAL_SUBJECT)

    await expect(t.mutation(internal.seed.devGame, {})).rejects.toThrow(/SANDLOT_DEV_SEED/)
    expect(await census(t)).toEqual({ teams: 0, players: 0, games: 0, lineups: 0 })
  })
})

describe('dev game in one step — which accounts it seats', () => {
  it('defaults home to the only real account, with the bot away', async () => {
    const t = harness()
    const me = await signIn(t, REAL_SUBJECT, 'Sam Hooper')

    const result = await runDevGame(t)

    expect(await seating(t, result.game)).toEqual({
      status: 'scheduled',
      home: me,
      away: 'bot',
    })
    expect(result).toMatchObject({ home: 'Sam Hooper', away: 'bot' })
  })

  it('asks for a sign-in when there is no real account yet', async () => {
    await expect(runDevGame(harness())).rejects.toThrow(/sign in to the app once/i)
  })

  it('seats one account per club when both are named', async () => {
    const t = harness()
    const { sam, max } = await signInSamAndMax(t)

    const result = await runDevGame(t, { home: 'Sam Hooper', away: 'Max Rivera' })

    expect(await seating(t, result.game)).toMatchObject({ home: sam, away: max })
    expect(result).toMatchObject({ home: 'Sam Hooper', away: 'Max Rivera' })
  })

  it('leaves the bot away when only --home is named among several accounts', async () => {
    const t = harness()
    const { max } = await signInSamAndMax(t)

    const result = await runDevGame(t, { home: 'max' })

    expect(await seating(t, result.game)).toMatchObject({
      home: max,
      away: 'bot',
    })
  })

  it('gives one account both clubs when --home and --away name it', async () => {
    const t = harness()
    const { sam } = await signInSamAndMax(t)

    const result = await runDevGame(t, { home: 'sam', away: 'Sam Hooper' })

    expect(await seating(t, result.game)).toMatchObject({ home: sam, away: sam })
    expect(result).toMatchObject({ home: 'Sam Hooper', away: 'Sam Hooper' })
  })

  it('lets --away alone name the only account, which then holds both clubs', async () => {
    const t = harness()
    const sam = await signIn(t, REAL_SUBJECT, 'Sam Hooper')

    const result = await runDevGame(t, { away: 'sam' })

    expect(await seating(t, result.game)).toMatchObject({ home: sam, away: sam })
  })

  it('requires --home when several accounts have signed in', async () => {
    const t = harness()
    await signInSamAndMax(t)

    await expect(runDevGame(t)).rejects.toThrow(/--home is required/)
    expect(await census(t)).toEqual({ teams: 0, players: 0, games: 0, lineups: 0 })
  })
})

describe('dev game in one step — matching a name', () => {
  it('matches the whole display name, ignoring case', async () => {
    const t = harness()
    const { max } = await signInSamAndMax(t)

    const result = await runDevGame(t, { home: 'MAX rivera' })

    expect((await seating(t, result.game)).home).toBe(max)
  })

  it('matches the first word of the display name', async () => {
    const t = harness()
    const { sam } = await signInSamAndMax(t)

    const result = await runDevGame(t, { home: 'sam' })

    expect((await seating(t, result.game)).home).toBe(sam)
  })

  it('lets a whole-name match win over first-word matches', async () => {
    const t = harness()
    const plain = await signIn(t, REAL_SUBJECT, 'Sam')
    await signIn(t, OTHER_SUBJECT, 'Sam Hooper')

    const result = await runDevGame(t, { home: 'sam' })

    expect((await seating(t, result.game)).home).toBe(plain)
  })

  it('counts first-word matches only when no whole name matches', async () => {
    const t = harness()
    await signIn(t, REAL_SUBJECT, 'Sam Hooper')
    await signIn(t, OTHER_SUBJECT, 'Sam Lee')

    await expect(runDevGame(t, { home: 'sam' })).rejects.toThrow(/several accounts named "sam"/)
  })

  it('never matches the bot, and never lists it as a candidate', async () => {
    const t = harness()
    await signIn(t, REAL_SUBJECT, 'Sam Hooper')
    await runDevGame(t) // creates the seed owner

    const refusal = String(await runDevGame(t, { home: 'Sandlot Dev' }).catch((e: unknown) => e))

    expect(refusal).toMatch(/no account named "Sandlot Dev"/)
    expect(refusal).not.toContain(SEED_CLERK_SUBJECT)
    expect(refusal).toContain(REAL_SUBJECT)
  })

  it('lists every account by name and subject when none matches, changing nothing', async () => {
    const t = harness()
    await signInSamAndMax(t)

    const refusal = String(await runDevGame(t, { home: 'nobody' }).catch((e: unknown) => e))

    expect(refusal).toContain(`Sam Hooper (${REAL_SUBJECT})`)
    expect(refusal).toContain(`Max Rivera (${OTHER_SUBJECT})`)
    expect(await census(t)).toEqual({ teams: 0, players: 0, games: 0, lineups: 0 })
  })

  it('lists the matches when a name is ambiguous, changing nothing', async () => {
    const t = harness()
    await signIn(t, REAL_SUBJECT, 'Sam Hooper')
    await signIn(t, OTHER_SUBJECT, 'Sam Lee')
    await signIn(t, 'user_third', 'Max Rivera')

    const refusal = String(await runDevGame(t, { home: 'sam' }).catch((e: unknown) => e))

    expect(refusal).toContain(`Sam Hooper (${REAL_SUBJECT})`)
    expect(refusal).toContain(`Sam Lee (${OTHER_SUBJECT})`)
    expect(refusal).not.toContain('Max Rivera')
    expect(await census(t)).toEqual({ teams: 0, players: 0, games: 0, lineups: 0 })
  })

  it('refuses a bad --away name before moving any club', async () => {
    const t = harness()
    await signInSamAndMax(t)
    const first = await runDevGame(t, { home: 'sam' })
    const before = await ownership(t)

    await expect(runDevGame(t, { home: 'max', away: 'nobody' })).rejects.toThrow(/no account named/)

    expect(await ownership(t)).toEqual(before)
    expect((await seating(t, first.game)).status).toBe('scheduled')
  })
})

describe('dev game in one step — setting up the same pairing again', () => {
  it.each([
    ['one account against another', { home: 'sam', away: 'max' }],
    ['one account against the bot', { home: 'sam' }],
    ['one account holding both clubs', { home: 'sam', away: 'sam' }],
  ])('sets up the same pairing twice without forking the league: %s', async (_name, args) => {
    const t = harness()
    await signInSamAndMax(t)

    await runDevGame(t, args)
    await runDevGame(t, args)

    expect(await census(t)).toEqual({ teams: 2, players: 20, games: 2, lineups: 4 })
  })

  it('still switches seating after the same pairing was set up twice', async () => {
    const t = harness()
    const { max } = await signInSamAndMax(t)
    await runDevGame(t, { home: 'sam', away: 'max' })
    await runDevGame(t, { home: 'sam', away: 'max' })

    const result = await runDevGame(t, { home: 'max' })

    expect((await seating(t, result.game)).home).toBe(max)
    expect(await census(t)).toMatchObject({ teams: 2, players: 20 })
  })
})

describe('dev game in one step — bot-managed sides and team ownership (SAN-76)', () => {
  it('makes the home side bot-managed with --home-bot, naming an account away', async () => {
    const t = harness()
    const { max } = await signInSamAndMax(t)

    const result = await runDevGame(t, { homeBot: true, away: 'max' })

    expect(await seating(t, result.game)).toMatchObject({ home: 'bot', away: max })
    expect(result).toMatchObject({ home: 'bot', away: 'Max Rivera' })
  })

  it('makes the away side bot-managed with --away-bot', async () => {
    const t = harness()
    const { sam } = await signInSamAndMax(t)

    const result = await runDevGame(t, { home: 'sam', awayBot: true })

    expect(await seating(t, result.game)).toMatchObject({ home: sam, away: 'bot' })
  })

  it('refuses both sides bot-managed, writing nothing', async () => {
    const t = harness()
    await signInSamAndMax(t)

    await expect(runDevGame(t, { homeBot: true, awayBot: true })).rejects.toThrow(/both sides/)
    expect(await census(t)).toEqual({ teams: 0, players: 0, games: 0, lineups: 0 })
  })

  it('refuses a side that names an account and the bot at once', async () => {
    const t = harness()
    await signInSamAndMax(t)

    await expect(runDevGame(t, { home: 'sam', homeBot: true })).rejects.toThrow(/use the bot/)
  })

  it('leaves team ownership and earlier games alone', async () => {
    const t = harness()
    await signInSamAndMax(t)
    const first = await runDevGame(t, { home: 'sam', away: 'max' })
    const owners = await ownership(t)
    const before = await seating(t, first.game)

    await runDevGame(t, { home: 'max', away: 'sam' })

    expect(await ownership(t)).toEqual(owners)
    expect(await seating(t, first.game)).toEqual(before)
  })

  it('refuses when a seed club has been moved to another owner, rather than seat around it', async () => {
    const { t, row } = await seeded()
    await claimClub(t, row.awayTeam)

    await expect(runDevGame(t)).rejects.toThrow(/expected either none or exactly/)
  })
})
