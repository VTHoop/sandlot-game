// @vitest-environment edge-runtime
/// <reference types="vite/client" />
import { isDuelNumber } from '@sandlot/engine/atBat'
import { pickBotNumber } from '@sandlot/engine/bot'
import { REGULATION_INNINGS } from '@sandlot/engine/game'
import { convexTest } from 'convex-test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api, internal } from './_generated/api'
import type { Doc, Id } from './_generated/dataModel'
import schema from './schema'
import { SEED_ENV_FLAG } from './seed'

/**
 * The server-side bot opponent (SAN-58). A seat is bot-controlled exactly when
 * its club is held by the dev seed owner, and only where the dev seed is enabled.
 * The bot commits the moment an at-bat opens — game start, and each resolution —
 * so every test here drives the scheduler rather than calling the bot by hand,
 * except where a test is about a trigger arriving late or twice.
 */

// convex-test discovers the function modules; exclude the test files themselves.
const modules = import.meta.glob(['./**/*.ts', '!./**/*.test.ts'])

const HUMAN = { subject: 'user_human_player', name: 'Human' }
const OTHER = { subject: 'user_second_player', name: 'Other' }

function harness() {
  return convexTest(schema, modules)
}

type Harness = ReturnType<typeof harness>

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

/** Run every scheduled function, including any those schedule in turn. */
function runScheduled(t: Harness): Promise<void> {
  return t.finishAllScheduledFunctions(vi.runAllTimers)
}

function gameRow(t: Harness, game: Id<'games'>): Promise<Doc<'games'>> {
  return t.run(async (ctx) => {
    const row = await ctx.db.get(game)
    if (!row) throw new Error('game vanished')
    return row
  })
}

/** Every sealed number on file for the game — read raw, since no query may. */
function commitments(t: Harness, game: Id<'games'>): Promise<Doc<'duelCommitments'>[]> {
  return t.run((ctx) =>
    ctx.db
      .query('duelCommitments')
      .withIndex('by_game', (q) => q.eq('game', game))
      .collect(),
  )
}

function atBats(t: Harness, game: Id<'games'>): Promise<Doc<'atBats'>[]> {
  return t.run((ctx) =>
    ctx.db
      .query('atBats')
      .withIndex('by_game', (q) => q.eq('game', game))
      .collect(),
  )
}

async function giveClub(t: Harness, team: Id<'teams'>, who: typeof HUMAN): Promise<void> {
  await t.withIdentity(who).mutation(api.users.provision, {})
  await t.mutation(internal.seed.assignClubToUser, { team, clerkSubject: who.subject })
}

/**
 * The seeded league with its home club handed to HUMAN. The away club stays with
 * the seed owner, so it is the bot's: in the top half the bot bats and HUMAN
 * pitches; in the bottom half they swap. The game is scheduled, not started.
 */
async function seededBotGame() {
  const t = harness()
  vi.stubEnv(SEED_ENV_FLAG, 'true')
  const game = await t.mutation(internal.seed.bootstrapDevLeague, {})
  const { homeTeam, awayTeam } = await gameRow(t, game)
  await giveClub(t, homeTeam, HUMAN)
  return { t, game, homeTeam, awayTeam }
}

/** {@link seededBotGame}, started by HUMAN. Nothing scheduled has run yet. */
async function startedBotGame() {
  const setup = await seededBotGame()
  await setup.t.withIdentity(HUMAN).mutation(api.game.startGame, { game: setup.game })
  return setup
}

/** HUMAN holds the home club, so they pitch in the top half and bat in the bottom. */
async function humanCommits(t: Harness, game: Id<'games'>, number: number): Promise<void> {
  const { half } = await gameRow(t, game)
  const human = t.withIdentity(HUMAN)
  if (half === 'top') await human.mutation(api.atBat.commitPitch, { game, number })
  else await human.mutation(api.atBat.commitSwing, { game, number })
}

describe('server-side bot — when it commits', () => {
  it('commits its seat for the first at-bat as soon as the game starts, with no human action', async () => {
    const { t, game } = await startedBotGame()
    await runScheduled(t)

    const rows = await commitments(t, game)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ sequence: 0, role: 'batting' })
  })

  it('commits for the next at-bat as soon as the previous one resolves', async () => {
    const { t, game } = await startedBotGame()
    await runScheduled(t)
    await humanCommits(t, game, 500)
    await runScheduled(t)

    expect(await atBats(t, game)).toHaveLength(1)
    const next = (await commitments(t, game)).filter((row) => row.sequence === 1)
    expect(next).toHaveLength(1)
    expect(next[0]?.role).toBe('batting')
  })

  it('resolves the at-bat when the human happens to commit before the bot has run', async () => {
    const { t, game } = await startedBotGame()
    await humanCommits(t, game, 250)
    await runScheduled(t)

    expect(await atBats(t, game)).toHaveLength(1)
  })
})

describe('server-side bot — the rules a human commit obeys', () => {
  it('commits a valid duel number and never declares a bunt', async () => {
    const { t, game } = await startedBotGame()
    await runScheduled(t)

    const [row] = await commitments(t, game)
    expect(isDuelNumber(row?.number ?? Number.NaN)).toBe(true)
    expect(row?.swingType).toBeUndefined()
  })

  it('treats a duplicate trigger for a seat it already committed as a quiet no-op', async () => {
    const { t, game } = await startedBotGame()
    await runScheduled(t)

    await expect(
      t.mutation(internal.atBat.commitBotSeat, { game, sequence: 0, role: 'batting' }),
    ).resolves.toBeNull()
    expect(await commitments(t, game)).toHaveLength(1)
  })

  it('treats a trigger for an at-bat that already resolved as a quiet no-op', async () => {
    const { t, game } = await startedBotGame()
    await runScheduled(t)
    await humanCommits(t, game, 500)
    await runScheduled(t)
    const before = await commitments(t, game)

    await expect(
      t.mutation(internal.atBat.commitBotSeat, { game, sequence: 0, role: 'batting' }),
    ).resolves.toBeNull()
    expect(await commitments(t, game)).toHaveLength(before.length)
    expect(await atBats(t, game)).toHaveLength(1)
  })

  it('treats a trigger on a game that is no longer live as a quiet no-op', async () => {
    const { t, game } = await startedBotGame()
    await t.run((ctx) => ctx.db.patch(game, { status: 'final' }))

    await expect(
      t.mutation(internal.atBat.commitBotSeat, { game, sequence: 0, role: 'batting' }),
    ).resolves.toBeNull()
    await runScheduled(t)
    expect(await commitments(t, game)).toHaveLength(0)
  })

  it('fails loudly when triggered for a seat whose club the bot no longer holds', async () => {
    const { t, game, awayTeam } = await startedBotGame()
    await giveClub(t, awayTeam, OTHER)

    await expect(
      t.mutation(internal.atBat.commitBotSeat, { game, sequence: 0, role: 'batting' }),
    ).rejects.toThrow('which it does not hold')
    expect(await commitments(t, game)).toHaveLength(0)
  })
})

describe('server-side bot — dev-only', () => {
  it('never commits where the dev seed is not enabled', async () => {
    const { t, game } = await seededBotGame()
    vi.stubEnv(SEED_ENV_FLAG, 'false')
    await t.withIdentity(HUMAN).mutation(api.game.startGame, { game })
    await runScheduled(t)

    expect(await commitments(t, game)).toHaveLength(0)
  })

  it('never commits in a game where both clubs are held by humans', async () => {
    const { t, game, awayTeam } = await seededBotGame()
    await giveClub(t, awayTeam, OTHER)
    await t.withIdentity(HUMAN).mutation(api.game.startGame, { game })
    await runScheduled(t)

    expect(await commitments(t, game)).toHaveLength(0)
  })
})

describe('server-side bot — the secret-state law', () => {
  // The same draw, four opponent situations: not yet committed, and committed
  // first with each end of the range and the middle. If anything about the
  // opponent's number reached the bot, one of these would disagree.
  const DRAW = 0.3141
  const scenarios: { label: string; opponent: number | null }[] = [
    { label: 'the opponent has not committed', opponent: null },
    { label: 'the opponent committed 1 first', opponent: 1 },
    { label: 'the opponent committed 999 first', opponent: 999 },
    { label: 'the opponent committed 500 first', opponent: 500 },
  ]

  it.each(scenarios)('commits the same number for the same draw when $label', async ({
    opponent,
  }) => {
    const { t, game } = await startedBotGame()
    // Pinned after setup, so only the bot's draw sees it.
    vi.spyOn(Math, 'random').mockReturnValue(DRAW)
    if (opponent !== null) await humanCommits(t, game, opponent)
    await runScheduled(t)

    const bot = (await commitments(t, game)).find(
      (row) => row.sequence === 0 && row.role === 'batting',
    )
    expect(bot?.number).toBe(pickBotNumber(() => DRAW))
  })
})

describe('server-side bot — a whole game', () => {
  // A regulation game is well under this many at-bats; the bound turns a
  // stalled game into a failure instead of a hang.
  const MAX_TURNS = 2000

  it('lets one signed-in human play from first pitch to final out against the bot', async () => {
    const { t, game } = await startedBotGame()

    for (let turn = 0; turn < MAX_TURNS; turn += 1) {
      await runScheduled(t)
      if ((await gameRow(t, game)).status === 'final') break
      await humanCommits(t, game, ((turn * 37) % 999) + 1)
    }

    const final = await gameRow(t, game)
    expect(final.status).toBe('final')
    // A game goes at least the engine's regulation length. (Not an at-bat
    // count: a double play records two outs in one at-bat.)
    expect(final.inning).toBeGreaterThanOrEqual(REGULATION_INNINGS)
    const log = await atBats(t, game)
    for (const row of log) {
      // Top half: the bot bats. Bottom half: the bot pitches.
      const botNumber = row.half === 'top' ? row.batterNumber : row.pitchNumber
      expect(isDuelNumber(botNumber)).toBe(true)
      if (row.half === 'top') expect(row.swingType).toBe('normal')
    }
    const lastSequence = Math.max(...log.map((row) => row.sequence))
    const orphaned = (await commitments(t, game)).filter((row) => row.sequence > lastSequence)
    expect(orphaned).toHaveLength(0)
  })
})
