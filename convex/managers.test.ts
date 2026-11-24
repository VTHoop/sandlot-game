// @vitest-environment edge-runtime
/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api, internal } from './_generated/api'
import type { Doc, Id } from './_generated/dataModel'
import schema from './schema'
import { SEED_CLERK_SUBJECT, SEED_ENV_FLAG } from './seed'

/**
 * Who plays each side of a game (SAN-76, ADR-0039). A game records a manager for
 * its home and away side — a user or the bot — and every question of "who is in
 * this game" reads those two, never `teams.owner`. These tests keep the two apart
 * on purpose: the managers are set by hand, and the teams stay with whoever the
 * seed gave them to, so a gate that still read ownership would give the wrong
 * answer.
 */

const modules = import.meta.glob(['./**/*.ts', '!./**/*.test.ts'])

const HOME = { subject: 'user_home_manager', name: 'Hana Home' }
const AWAY = { subject: 'user_away_manager', name: 'Axel Away' }
const OWNER = { subject: 'user_team_owner', name: 'Olive Owner' }

type Who = typeof HOME
type Harness = ReturnType<typeof harness>
type Manager = NonNullable<Doc<'games'>['homeManager']>

function harness() {
  return convexTest(schema, modules)
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubEnv(SEED_ENV_FLAG, 'true')
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

function runScheduled(t: Harness): Promise<void> {
  return t.finishAllScheduledFunctions(vi.runAllTimers)
}

async function provision(t: Harness, who: Who): Promise<Id<'users'>> {
  await t.withIdentity(who).mutation(api.users.provision, {})
  return t.run(async (ctx) => {
    const row = await ctx.db
      .query('users')
      .withIndex('by_clerk_subject', (q) => q.eq('clerkSubject', who.subject))
      .unique()
    if (!row) throw new Error('not provisioned')
    return row._id
  })
}

const user = (id: Id<'users'>): Manager => ({ kind: 'user', user: id })
const BOT: Manager = { kind: 'bot' }

function setManagers(t: Harness, game: Id<'games'>, home: Manager, away: Manager) {
  return t.run((ctx) => ctx.db.patch(game, { homeManager: home, awayManager: away }))
}

function gameRow(t: Harness, game: Id<'games'>): Promise<Doc<'games'>> {
  return t.run(async (ctx) => {
    const row = await ctx.db.get(game)
    if (!row) throw new Error('game vanished')
    return row
  })
}

/** A scheduled seed game: both teams are owned by the seed account, nobody manages it yet. */
async function scheduledGame(t: Harness): Promise<Id<'games'>> {
  return t.mutation(internal.seed.bootstrapDevLeague, {})
}

/** A scheduled game managed by two signed-in users, with a third who only owns a team in it. */
async function managedGame() {
  const t = harness()
  // One after another: concurrent provisions conflict, and a retry waits on a timer.
  const home = await provision(t, HOME)
  const away = await provision(t, AWAY)
  const owner = await provision(t, OWNER)
  const game = await scheduledGame(t)
  await setManagers(t, game, user(home), user(away))
  const { homeTeam } = await gameRow(t, game)
  await t.run((ctx) => ctx.db.patch(homeTeam, { owner }))
  return { t, game, homeTeam, ids: { home, away, owner } }
}

/** {@link managedGame}, started. Top half: away bats, home pitches. */
async function liveGame() {
  const setup = await managedGame()
  await setup.t.withIdentity(HOME).mutation(api.game.startGame, { game: setup.game })
  return setup
}

describe('games record their managers', () => {
  it('writes the seed owner as the manager of both sides of a bootstrapped game', async () => {
    const t = harness()
    const seedOwner = await t.run(async (ctx) => {
      const game = await ctx.db.get(await t.mutation(internal.seed.bootstrapDevLeague, {}))
      return game
    })
    expect(seedOwner?.homeManager?.kind).toBe('user')
    expect(seedOwner?.awayManager?.kind).toBe('user')
  })
})

describe('commit and participation checks read the managers', () => {
  it('lets a side’s manager commit and refuses a team owner who manages neither side', async () => {
    const { t, game } = await liveGame()
    await expect(
      t.withIdentity(OWNER).mutation(api.atBat.commitPitch, { game, number: 5 }),
    ).rejects.toThrow()
    await expect(
      t.withIdentity(OWNER).mutation(api.atBat.commitSwing, { game, number: 5 }),
    ).rejects.toThrow()
    await expect(
      t.withIdentity(HOME).mutation(api.atBat.commitPitch, { game, number: 5 }),
    ).resolves.not.toThrow()
  })

  it('refuses a manager the seat of the other side', async () => {
    const { t, game } = await liveGame()
    // Top half: the away manager bats, so the home manager cannot swing.
    await expect(
      t.withIdentity(HOME).mutation(api.atBat.commitSwing, { game, number: 5 }),
    ).rejects.toThrow()
  })

  it('lets one account managing both sides commit in either seat, in both halves', async () => {
    const t = harness()
    const both = await provision(t, HOME)
    const game = await scheduledGame(t)
    await setManagers(t, game, user(both), user(both))
    await t.withIdentity(HOME).mutation(api.game.startGame, { game })

    const commitBoth = async (sequence: number) => {
      await t.withIdentity(HOME).mutation(api.atBat.commitPitch, { game, number: 100 })
      await t.withIdentity(HOME).mutation(api.atBat.commitSwing, { game, number: 600 })
      expect((await gameRow(t, game)).lastResolvedSequence).toBe(sequence)
    }
    await commitBoth(0)
    await t.run((ctx) => ctx.db.patch(game, { half: 'bottom' }))
    await commitBoth(1)
  })

  it('refuses to start a game for a team owner who manages neither side', async () => {
    const { t, game } = await managedGame()
    await expect(t.withIdentity(OWNER).mutation(api.game.startGame, { game })).rejects.toThrow(
      'Not authorized for this game',
    )
  })

  it('hides the game from a team owner who manages neither side', async () => {
    const { t, game } = await liveGame()
    expect(await t.withIdentity(OWNER).query(api.gameView.getGame, { game })).toBeNull()
    expect(await t.withIdentity(HOME).query(api.gameView.getGame, { game })).not.toBeNull()
  })

  it('leaves the managers alone when a team changes owner', async () => {
    const { t, game, homeTeam, ids } = await liveGame()
    const before = await gameRow(t, game)
    await t.run((ctx) => ctx.db.patch(homeTeam, { owner: ids.away }))

    const after = await gameRow(t, game)
    expect([after.homeManager, after.awayManager]).toEqual([before.homeManager, before.awayManager])
    await expect(
      t.withIdentity(HOME).mutation(api.atBat.commitPitch, { game, number: 5 }),
    ).resolves.not.toThrow()
  })
})

describe('"My games"', () => {
  it('lists a game for its managers and not for a team owner who manages neither', async () => {
    const { t, game } = await managedGame()
    const ids = async (who: Who) =>
      (await t.withIdentity(who).query(api.myGames.listMyGames, {})).map((row) => row.id)
    expect(await ids(HOME)).toEqual([game])
    expect(await ids(AWAY)).toEqual([game])
    expect(await ids(OWNER)).toEqual([])
  })

  it('names each side’s manager, and "Bot" for a bot-managed side', async () => {
    const { t, game, ids } = await managedGame()
    await setManagers(t, game, user(ids.home), BOT)
    const [row] = await t.withIdentity(HOME).query(api.myGames.listMyGames, {})
    expect(row.home.manager).toBe(HOME.name)
    expect(row.away.manager).toBe('Bot')
  })
})

describe('push recipients', () => {
  it('sends a seat’s push to its manager’s devices, not the team owner’s', async () => {
    const { t, game, ids } = await liveGame()
    const device = (user: Id<'users'>, endpoint: string) =>
      t.run((ctx) => ctx.db.insert('pushSubscriptions', { user, endpoint, p256dh: 'k', auth: 'a' }))
    await device(ids.owner, 'https://push.example/owner')
    await device(ids.home, 'https://push.example/manager')

    const turn = await t.query(internal.push.turnFor, { game, sequence: 0, seat: 'home' })
    expect(turn?.subscriptions.map((sub) => sub.endpoint)).toEqual(['https://push.example/manager'])
  })
})

describe('the bot plays exactly the sides the game names it for', () => {
  it('plays a bot-managed side whoever owns the team and with the seed disabled', async () => {
    const { t, game, ids } = await managedGame()
    await setManagers(t, game, user(ids.home), BOT)
    await t.withIdentity(HOME).mutation(api.game.startGame, { game })
    vi.stubEnv(SEED_ENV_FLAG, 'false')
    await runScheduled(t)

    const rows = await t.run((ctx) =>
      ctx.db
        .query('duelCommitments')
        .withIndex('by_game', (q) => q.eq('game', game))
        .collect(),
    )
    expect(rows.map((row) => row.role)).toEqual(['batting'])
  })

  it('refuses a human a commit on a bot-managed side and keeps the bot’s number secret', async () => {
    const { t, game, ids } = await managedGame()
    await setManagers(t, game, user(ids.home), BOT)
    await t.withIdentity(HOME).mutation(api.game.startGame, { game })
    await runScheduled(t) // top half: the bot, managing the away side, bats and commits

    // The bot's seat is the batter's. Neither the other side's manager nor the away
    // side's team owner can commit a swing into it.
    await expect(
      t.withIdentity(HOME).mutation(api.atBat.commitSwing, { game, number: 5 }),
    ).rejects.toThrow()
    await expect(
      t.withIdentity(AWAY).mutation(api.atBat.commitSwing, { game, number: 5 }),
    ).rejects.toThrow()
    const rows = await t.run((ctx) => ctx.db.query('duelCommitments').collect())
    expect(rows.map((row) => row.role)).toEqual(['batting'])

    // The human pitcher sees only that the bot has locked, never its number.
    const view = await t.withIdentity(HOME).query(api.atBat.getActiveDuel, { game })
    expect(view?.status).toBe('awaiting_opponent')
    expect(view?.swingCommitted).toBe(true)
    expect(view).not.toHaveProperty('batterNumber')
  })

  it('never plays a user-managed side whose team the seed account owns', async () => {
    const { t, game, ids } = await managedGame()
    await setManagers(t, game, user(ids.home), user(ids.away))
    await t.withIdentity(HOME).mutation(api.game.startGame, { game })
    await runScheduled(t)

    const rows = await t.run((ctx) => ctx.db.query('duelCommitments').collect())
    expect(rows).toEqual([])
  })
})

describe('backfilling the managers of existing games', () => {
  /** A game as it was before this change: the managers absent, the teams owned. */
  async function legacyGame(t: Harness, homeOwner: Id<'users'>, awayOwner: Id<'users'>) {
    const game = await scheduledGame(t)
    const { homeTeam, awayTeam } = await gameRow(t, game)
    await t.run(async (ctx) => {
      await ctx.db.patch(homeTeam, { owner: homeOwner })
      await ctx.db.patch(awayTeam, { owner: awayOwner })
      await ctx.db.patch(game, { homeManager: undefined, awayManager: undefined })
    })
    return game
  }

  it('copies each team’s current owner onto its side', async () => {
    const t = harness()
    const home = await provision(t, HOME)
    const away = await provision(t, AWAY)
    const game = await legacyGame(t, home, away)

    await t.mutation(internal.seed.backfillGameManagers, {})

    const row = await gameRow(t, game)
    expect(row.homeManager).toEqual(user(home))
    expect(row.awayManager).toEqual(user(away))
  })

  it('makes a side the seed account holds bot-managed while the seed is enabled', async () => {
    const t = harness()
    const home = await provision(t, HOME)
    await scheduledGame(t) // creates the seed account, and a game that already has managers
    const seedOwner = await t.run(async (ctx) => {
      const row = await ctx.db
        .query('users')
        .withIndex('by_clerk_subject', (q) => q.eq('clerkSubject', SEED_CLERK_SUBJECT))
        .unique()
      if (!row) throw new Error('no seed owner')
      return row._id
    })
    const game = await legacyGame(t, home, seedOwner)

    await t.mutation(internal.seed.backfillGameManagers, {})

    expect((await gameRow(t, game)).homeManager).toEqual(user(home))
    expect((await gameRow(t, game)).awayManager).toEqual(BOT)
  })

  it('keeps the seed account as a user manager when the seed is disabled', async () => {
    const t = harness()
    const home = await provision(t, HOME)
    const game = await scheduledGame(t)
    const { homeTeam, awayTeam } = await gameRow(t, game)
    const seedOwner = (await t.run((ctx) => ctx.db.get(awayTeam)))?.owner
    if (!seedOwner) throw new Error('no seed owner')
    await t.run(async (ctx) => {
      await ctx.db.patch(game, { homeManager: undefined, awayManager: undefined })
      await ctx.db.patch(homeTeam, { owner: home })
    })
    vi.stubEnv(SEED_ENV_FLAG, 'false')

    await t.mutation(internal.seed.backfillGameManagers, {})

    expect((await gameRow(t, game)).awayManager).toEqual(user(seedOwner))
  })

  it('leaves a side that already has a manager alone, and does nothing on a re-run', async () => {
    const t = harness()
    const home = await provision(t, HOME)
    const away = await provision(t, AWAY)
    const game = await legacyGame(t, home, away)
    await t.run((ctx) => ctx.db.patch(game, { homeManager: BOT })) // set by hand, not the owner

    expect(await t.mutation(internal.seed.backfillGameManagers, {})).toBe(1)
    const filled = await gameRow(t, game)
    expect(filled.homeManager).toEqual(BOT)
    expect(filled.awayManager).toEqual(user(away))

    // Re-pointing the team afterwards changes nothing: a second run finds no game to fill.
    await t.run((ctx) => ctx.db.patch(filled.awayTeam, { owner: home }))
    expect(await t.mutation(internal.seed.backfillGameManagers, {})).toBe(0)
    const again = await gameRow(t, game)
    expect(again.homeManager).toEqual(BOT)
    expect(again.awayManager).toEqual(user(away))
  })

  it('fails, rather than skips, a game whose team owner no longer exists', async () => {
    const t = harness()
    const home = await provision(t, HOME)
    const away = await provision(t, AWAY)
    await legacyGame(t, home, away)
    await t.run((ctx) => ctx.db.delete(away))

    await expect(t.mutation(internal.seed.backfillGameManagers, {})).rejects.toThrow()
  })

  it('refuses a manager-less game whose team is an ownerless real MLB team (SAN-78)', async () => {
    const t = harness()
    const home = await provision(t, HOME)
    const away = await provision(t, AWAY)
    const game = await legacyGame(t, home, away)
    const { awayTeam } = await gameRow(t, game)
    await t.run(async (ctx) => {
      const team = await ctx.db.get(awayTeam)
      if (!team) throw new Error('fixture team vanished')
      await ctx.db.replace(awayTeam, { name: team.name }) // drops `owner`
    })

    await expect(t.mutation(internal.seed.backfillGameManagers, {})).rejects.toThrow(/has no owner/)
  })
})
