// @vitest-environment edge-runtime
/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import webpush from 'web-push'
import { api, internal } from './_generated/api'
import type { Doc, Id } from './_generated/dataModel'
import schema from './schema'
import { SEED_ENV_FLAG } from './seed'

/**
 * Web push + scheduled turn reminders (SAN-23, ADR-0003). The push service is
 * mocked at `web-push`'s `sendNotification`, so every test reads what would have
 * left the server: who, when, and exactly what the payload said. Time is faked,
 * so a reminder 12h out is a clock advance, not a wait.
 */

vi.mock('web-push', () => ({
  default: { setVapidDetails: vi.fn(), sendNotification: vi.fn() },
}))

const modules = import.meta.glob(['./**/*.ts', '!./**/*.test.ts'])

const HUMAN = { subject: 'user_human_player', name: 'Human' }
const OTHER = { subject: 'user_second_player', name: 'Other' }

const HOUR = 3_600_000

/** What the push service was handed, and when. */
interface Sent {
  endpoint: string
  at: number
  payload: { title: string; body: string; url: string }
}

let sent: Sent[]
/** Endpoints the mocked push service reports as gone (410) or failing (500). */
let gone: Set<string>
let failing: Set<string>
let t0: number

beforeEach(() => {
  vi.useFakeTimers()
  t0 = Date.now()
  sent = []
  gone = new Set()
  failing = new Set()
  vi.stubEnv('VAPID_PUBLIC_KEY', 'test-public-key')
  vi.stubEnv('VAPID_PRIVATE_KEY', 'test-private-key')
  vi.stubEnv('VAPID_SUBJECT', 'mailto:test@example.com')
  vi.mocked(webpush.sendNotification).mockImplementation(async (subscription, body) => {
    if (gone.has(subscription.endpoint)) throw Object.assign(new Error('gone'), { statusCode: 410 })
    if (failing.has(subscription.endpoint)) {
      throw Object.assign(new Error('unavailable'), { statusCode: 500 })
    }
    sent.push({
      endpoint: subscription.endpoint,
      at: Date.now() - t0,
      payload: JSON.parse(String(body)),
    })
    return { statusCode: 201, body: '', headers: {} }
  })
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

function harness() {
  return convexTest(schema, modules)
}

type Harness = ReturnType<typeof harness>

/**
 * Advance the clock and let every function that came due run to completion.
 *
 * The clock moves an hour at a time, running what fell due before moving on:
 * convex-test starts a due function from a timer but finishes it asynchronously,
 * so one long jump would run every function at the end time and a push would
 * read as sent at 200h instead of 12h. Everything here is on the hour.
 */
async function elapse(t: Harness, ms: number): Promise<void> {
  vi.advanceTimersByTime(0)
  await t.finishInProgressScheduledFunctions()
  for (let left = ms; left > 0; left -= HOUR) {
    vi.advanceTimersByTime(Math.min(left, HOUR))
    await t.finishInProgressScheduledFunctions()
  }
}

function gameRow(t: Harness, game: Id<'games'>): Promise<Doc<'games'>> {
  return t.run(async (ctx) => {
    const row = await ctx.db.get(game)
    if (!row) throw new Error('game vanished')
    return row
  })
}

function clubName(t: Harness, team: Id<'teams'>): Promise<string> {
  return t.run(async (ctx) => {
    const row = await ctx.db.get(team)
    if (!row) throw new Error('club vanished')
    return row.name
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

function subscribe(t: Harness, who: typeof HUMAN, endpoint: string): Promise<unknown> {
  return t.withIdentity(who).mutation(api.push.subscribe, {
    endpoint,
    p256dh: `p256dh-${endpoint}`,
    auth: `auth-${endpoint}`,
  })
}

/**
 * The seeded league with both clubs held by humans: HUMAN has home, OTHER has
 * away, each with one allowed device. Scheduled, not started. In the top half
 * OTHER bats and HUMAN pitches.
 */
async function twoHumanGame() {
  const t = harness()
  vi.stubEnv(SEED_ENV_FLAG, 'true')
  const game = await t.mutation(internal.seed.bootstrapDevLeague, {})
  const { homeTeam, awayTeam } = await gameRow(t, game)
  await giveClub(t, homeTeam, HUMAN)
  await giveClub(t, awayTeam, OTHER)
  await subscribe(t, HUMAN, 'https://fcm.googleapis.com/fcm/send/human')
  await subscribe(t, OTHER, 'https://fcm.googleapis.com/fcm/send/other')
  return { t, game, homeTeam, awayTeam }
}

async function startedGame() {
  const setup = await twoHumanGame()
  await setup.t.withIdentity(HUMAN).mutation(api.game.startGame, { game: setup.game })
  await elapse(setup.t, 0)
  return setup
}

function humanPitches(t: Harness, game: Id<'games'>, number: number) {
  return t.withIdentity(HUMAN).mutation(api.atBat.commitPitch, { game, number })
}

function otherSwings(t: Harness, game: Id<'games'>, number: number) {
  return t.withIdentity(OTHER).mutation(api.atBat.commitSwing, { game, number })
}

const to = (endpoint: string) => (s: Sent) => s.endpoint === endpoint
const HUMAN_DEVICE = 'https://fcm.googleapis.com/fcm/send/human'
const OTHER_DEVICE = 'https://fcm.googleapis.com/fcm/send/other'

describe('push — when an at-bat opens', () => {
  it('sends each seat one "your turn" push when the game starts', async () => {
    const { t } = await startedGame()
    await elapse(t, HOUR)

    expect(sent.filter(to(HUMAN_DEVICE))).toHaveLength(1)
    expect(sent.filter(to(OTHER_DEVICE))).toHaveLength(1)
  })

  it('sends each seat one push when an at-bat resolves and the game stays live', async () => {
    const { t, game } = await startedGame()
    await humanPitches(t, game, 300)
    await otherSwings(t, game, 700)
    await elapse(t, 0)

    expect(await atBats(t, game)).toHaveLength(1)
    expect(sent.filter(to(HUMAN_DEVICE))).toHaveLength(2)
    expect(sent.filter(to(OTHER_DEVICE))).toHaveLength(2)
  })

  it('does not send when the opponent locks', async () => {
    const { t, game } = await startedGame()
    const before = sent.length
    await otherSwings(t, game, 700)
    await elapse(t, HOUR)

    expect(sent).toHaveLength(before)
  })

  it('sends nothing for a game that is not live', async () => {
    const { t, game } = await twoHumanGame()
    await elapse(t, 100 * HOUR)

    expect(await gameRow(t, game).then((g) => g.status)).toBe('scheduled')
    expect(sent).toHaveLength(0)
  })
})

describe('push — what it says', () => {
  it('reads "Your turn vs {opponent club}" with the inning and score, and opens that game', async () => {
    const { t, game, homeTeam, awayTeam } = await startedGame()
    const [home, away] = await Promise.all([clubName(t, homeTeam), clubName(t, awayTeam)])

    const toHuman = sent.find(to(HUMAN_DEVICE))
    const toOther = sent.find(to(OTHER_DEVICE))
    expect(toHuman?.payload.title).toBe(`Your turn vs ${away}`)
    expect(toOther?.payload.title).toBe(`Your turn vs ${home}`)
    expect(toHuman?.payload.body).toBe(`Top 1 · ${away} 0, ${home} 0`)
    expect(toHuman?.payload.url).toBe(`/game/${game}`)
  })

  it('carries the same wording on a reminder', async () => {
    const { t } = await startedGame()
    await elapse(t, 12 * HOUR)

    const [first, reminder] = sent.filter(to(HUMAN_DEVICE))
    expect(reminder.payload).toEqual(first.payload)
  })
})

describe('push — the secret-state law', () => {
  it('never carries a duel number, or anything about whether the opponent has locked', async () => {
    const { t, game } = await startedGame()
    const untouched = sent.filter(to(HUMAN_DEVICE))[0]

    // The opponent locks a distinctive number, then the HUMAN's reminders run.
    await otherSwings(t, game, 737)
    await elapse(t, 12 * HOUR)
    const sealed = (await commitments(t, game)).map((row) => String(row.number))
    expect(sealed).toContain('737')

    const everything = JSON.stringify(sent)
    for (const number of sealed) expect(everything).not.toContain(number)
    // The payload's shape is closed: nothing but title, body and url can leak.
    for (const s of sent) expect(Object.keys(s.payload).sort()).toEqual(['body', 'title', 'url'])
    // A reminder after the opponent locked reads exactly as the first push did.
    const reminders = sent.filter(to(HUMAN_DEVICE)).slice(1)
    expect(reminders).toHaveLength(1)
    expect(reminders[0].payload).toEqual(untouched.payload)
  })
})

describe('push — reminders', () => {
  it('reminds an unlocked seat at 12h, then every 24h, at most three times', async () => {
    const { t } = await startedGame()
    await elapse(t, 200 * HOUR)

    expect(sent.filter(to(HUMAN_DEVICE)).map((s) => s.at)).toEqual([
      0,
      12 * HOUR,
      36 * HOUR,
      60 * HOUR,
    ])
  })

  it('stops reminding a seat once it locks, and keeps reminding the one that has not', async () => {
    const { t, game } = await startedGame()
    await elapse(t, HOUR)
    await otherSwings(t, game, 700)
    await elapse(t, 200 * HOUR)

    expect(sent.filter(to(OTHER_DEVICE))).toHaveLength(1)
    expect(sent.filter(to(HUMAN_DEVICE))).toHaveLength(4)
  })

  it('stops when the game leaves live', async () => {
    const { t, game } = await startedGame()
    await t.run((ctx) => ctx.db.patch(game, { status: 'final' }))
    await elapse(t, 200 * HOUR)

    expect(sent.filter(to(HUMAN_DEVICE))).toHaveLength(1)
    expect(sent.filter(to(OTHER_DEVICE))).toHaveLength(1)
  })

  it('does not let the previous at-bat’s reminders fire into the next one', async () => {
    const { t, game } = await startedGame()
    await elapse(t, HOUR)
    await humanPitches(t, game, 300)
    await otherSwings(t, game, 700)
    // The first at-bat's 12h reminder falls due here, and must stay quiet.
    await elapse(t, 11 * HOUR)
    expect(sent.filter(to(HUMAN_DEVICE)).map((s) => s.at)).toEqual([0, HOUR])
    // The new at-bat opened at 1h: its own reminder is due at 13h.
    await elapse(t, HOUR)
    expect(sent.filter(to(HUMAN_DEVICE)).map((s) => s.at)).toEqual([0, HOUR, 13 * HOUR])
  })

  it('never changes game state', async () => {
    const { t, game } = await startedGame()
    const snapshot = async () => ({
      game: await gameRow(t, game),
      atBats: await atBats(t, game),
      commitments: await commitments(t, game),
    })
    const before = await snapshot()
    await elapse(t, 200 * HOUR)

    expect(sent.length).toBeGreaterThan(2)
    expect(await snapshot()).toEqual(before)
  })

  it('keeps each game’s reminders independent of every other game’s', async () => {
    const { t, game: first, homeTeam, awayTeam } = await startedGame()
    const second = await t.mutation(internal.seed.mintDevGame, { homeTeam, awayTeam })
    await t.withIdentity(HUMAN).mutation(api.game.startGame, { game: second })
    await elapse(t, 0)

    // OTHER locks in the first game only.
    await otherSwings(t, first, 700)
    await elapse(t, 200 * HOUR)

    const inGame = (id: Id<'games'>) => (s: Sent) => s.payload.url === `/game/${id}`
    expect(sent.filter(to(OTHER_DEVICE)).filter(inGame(first))).toHaveLength(1)
    expect(sent.filter(to(OTHER_DEVICE)).filter(inGame(second))).toHaveLength(4)
  })
})

describe('push — devices and permission', () => {
  it('sends to every device a player has allowed', async () => {
    const { t } = await twoHumanGame()
    await subscribe(t, HUMAN, 'https://fcm.googleapis.com/fcm/send/human-tablet')
    const { game } = { game: (await t.run((ctx) => ctx.db.query('games').first()))?._id }
    if (!game) throw new Error('no game')
    await t.withIdentity(HUMAN).mutation(api.game.startGame, { game })
    await elapse(t, 0)

    expect(sent.filter(to(HUMAN_DEVICE))).toHaveLength(1)
    expect(sent.filter(to('https://fcm.googleapis.com/fcm/send/human-tablet'))).toHaveLength(1)
  })

  it('deletes a subscription the push service reports as gone, and still reaches the rest', async () => {
    const { t } = await twoHumanGame()
    await subscribe(t, HUMAN, 'https://fcm.googleapis.com/fcm/send/human-dead')
    gone.add('https://fcm.googleapis.com/fcm/send/human-dead')
    const game = (await t.run((ctx) => ctx.db.query('games').first()))?._id
    if (!game) throw new Error('no game')
    await t.withIdentity(HUMAN).mutation(api.game.startGame, { game })
    await elapse(t, 0)

    const left = await t.run((ctx) => ctx.db.query('pushSubscriptions').collect())
    expect(left.map((row) => row.endpoint).sort()).toEqual([HUMAN_DEVICE, OTHER_DEVICE])
    expect(sent.filter(to(HUMAN_DEVICE))).toHaveLength(1)
  })

  it('keeps a subscription whose push merely failed', async () => {
    const { t } = await twoHumanGame()
    failing.add(HUMAN_DEVICE)
    const game = (await t.run((ctx) => ctx.db.query('games').first()))?._id
    if (!game) throw new Error('no game')
    await t.withIdentity(HUMAN).mutation(api.game.startGame, { game })
    await elapse(t, 0)

    const left = await t.run((ctx) => ctx.db.query('pushSubscriptions').collect())
    expect(left.map((row) => row.endpoint)).toContain(HUMAN_DEVICE)
  })

  it('plays exactly as before for a player with no subscription', async () => {
    const t = harness()
    vi.stubEnv(SEED_ENV_FLAG, 'true')
    const game = await t.mutation(internal.seed.bootstrapDevLeague, {})
    const { homeTeam, awayTeam } = await gameRow(t, game)
    await giveClub(t, homeTeam, HUMAN)
    await giveClub(t, awayTeam, OTHER)
    await t.withIdentity(HUMAN).mutation(api.game.startGame, { game })
    await humanPitches(t, game, 300)
    await otherSwings(t, game, 700)
    await elapse(t, 200 * HOUR)

    expect(await atBats(t, game)).toHaveLength(1)
    expect(sent).toHaveLength(0)
  })

  it('refuses a subscription from a caller who is not signed in', async () => {
    const t = harness()
    await expect(
      t.mutation(api.push.subscribe, {
        endpoint: 'https://fcm.googleapis.com/fcm/send/x',
        p256dh: 'p',
        auth: 'a',
      }),
    ).rejects.toThrow('Not authenticated')
  })
})

describe('push — it never costs the at-bat', () => {
  it('still resolves and advances the game when every push fails', async () => {
    const { t, game } = await startedGame()
    failing.add(HUMAN_DEVICE)
    failing.add(OTHER_DEVICE)
    await humanPitches(t, game, 300)
    await otherSwings(t, game, 700)
    await elapse(t, 200 * HOUR)

    expect(await atBats(t, game)).toHaveLength(1)
    expect((await gameRow(t, game)).lastResolvedSequence).toBe(0)
  })
})

describe('push — a bot game', () => {
  it('notifies the human seat and nobody else', async () => {
    const t = harness()
    vi.stubEnv(SEED_ENV_FLAG, 'true')
    const game = await t.mutation(internal.seed.bootstrapDevLeague, {})
    const { homeTeam } = await gameRow(t, game)
    await giveClub(t, homeTeam, HUMAN)
    await subscribe(t, HUMAN, HUMAN_DEVICE)
    await t.withIdentity(HUMAN).mutation(api.game.startGame, { game })
    await elapse(t, 0)

    expect(sent.map((s) => s.endpoint)).toEqual([HUMAN_DEVICE])
  })
})

describe('push — which endpoints may be stored', () => {
  const subscribeTo = (t: Harness, endpoint: string) =>
    t.withIdentity(HUMAN).mutation(api.push.subscribe, { endpoint, p256dh: 'p256dh', auth: 'auth' })

  async function provisioned() {
    const t = harness()
    await t.withIdentity(HUMAN).mutation(api.users.provision, {})
    return t
  }

  it('takes the endpoints real push services hand out', async () => {
    const t = await provisioned()
    for (const endpoint of [
      'https://fcm.googleapis.com/fcm/send/abc',
      'https://updates.push.services.mozilla.com/wpush/v2/abc',
      'https://web.push.apple.com/abc',
      'https://wns2-par02p.notify.windows.com/w/?token=abc',
    ]) {
      await expect(subscribeTo(t, endpoint)).resolves.toBeNull()
    }
  })

  it('refuses an endpoint that is not a push service, so the server never posts to a caller-chosen host', async () => {
    const t = await provisioned()
    for (const endpoint of [
      'http://fcm.googleapis.com/fcm/send/abc',
      'https://internal.example.test/hook',
      'https://fcm.googleapis.com.evil.test/fcm/send/abc',
      'https://evil.test/web.push.apple.com',
      'https://fcm.googleapis.com:8443/fcm/send/abc',
      'https://user:pw@fcm.googleapis.com/fcm/send/abc',
      'not a url',
    ]) {
      await expect(subscribeTo(t, endpoint)).rejects.toThrow('push service')
    }
    expect(await t.run((ctx) => ctx.db.query('pushSubscriptions').collect())).toHaveLength(0)
  })
})

describe('push — one row per device', () => {
  it('keeps exactly one row when the same user registers the same device twice', async () => {
    const { t } = await twoHumanGame()
    await subscribe(t, HUMAN, HUMAN_DEVICE)

    const rows = await t.run((ctx) => ctx.db.query('pushSubscriptions').collect())
    expect(rows.filter((row) => row.endpoint === HUMAN_DEVICE)).toHaveLength(1)
  })

  it('hands a device to whoever registered it last, so the first user’s turns stop reaching it', async () => {
    const { t, game } = await twoHumanGame()
    await subscribe(t, OTHER, HUMAN_DEVICE)
    await t.withIdentity(HUMAN).mutation(api.game.startGame, { game })
    await elapse(t, 0)

    // The home seat's push goes to HUMAN's remaining devices — none — and the
    // away seat's now reaches the shared device as well as OTHER's own.
    expect(sent.filter(to(HUMAN_DEVICE))).toHaveLength(1)
    expect(sent.filter(to(HUMAN_DEVICE))[0]?.payload.title).toMatch(/^Your turn vs /)
    const [row] = await t.run((ctx) =>
      ctx.db
        .query('pushSubscriptions')
        .withIndex('by_endpoint', (q) => q.eq('endpoint', HUMAN_DEVICE))
        .collect(),
    )
    const other = await t.run((ctx) =>
      ctx.db
        .query('users')
        .withIndex('by_clerk_subject', (q) => q.eq('clerkSubject', OTHER.subject))
        .unique(),
    )
    expect(row?.user).toBe(other?._id)
  })
})

describe('push — what the push service tells us', () => {
  it('deletes a subscription reported as 404 as well as 410', async () => {
    const { t } = await twoHumanGame()
    vi.mocked(webpush.sendNotification).mockImplementation(async (subscription) => {
      if (subscription.endpoint === HUMAN_DEVICE) {
        throw Object.assign(new Error('not found'), { statusCode: 404 })
      }
      return { statusCode: 201, body: '', headers: {} }
    })
    const game = (await t.run((ctx) => ctx.db.query('games').first()))?._id
    if (!game) throw new Error('no game')
    await t.withIdentity(HUMAN).mutation(api.game.startGame, { game })
    await elapse(t, 0)

    const left = await t.run((ctx) => ctx.db.query('pushSubscriptions').collect())
    expect(left.map((row) => row.endpoint)).toEqual([OTHER_DEVICE])
  })

  it('does not wait on a push service that never answers', async () => {
    await startedGame()

    for (const call of vi.mocked(webpush.sendNotification).mock.calls) {
      expect(call[2]).toMatchObject({ timeout: 10_000 })
    }
    expect(vi.mocked(webpush.sendNotification)).toHaveBeenCalled()
  })
})

describe('push — more of the secret-state law', () => {
  it('never carries the pitcher’s number either', async () => {
    const { t, game } = await startedGame()
    await humanPitches(t, game, 913)
    await elapse(t, 200 * HOUR)

    expect((await commitments(t, game)).map((row) => row.number)).toContain(913)
    expect(JSON.stringify(sent)).not.toContain('913')
  })
})

describe('push — the at-bat that ends the game', () => {
  it('sends no push and no reminders for a game it has just finished', async () => {
    const { t, game } = await startedGame()
    // The away club is far behind in the top of the last inning with two out, so
    // the next out ends the game.
    await t.run((ctx) =>
      ctx.db.patch(game, { inning: 6, half: 'top', outs: 2, homeScore: 20, awayScore: 0 }),
    )

    let sentBefore = sent.length
    for (let atBat = 0; atBat < 60; atBat += 1) {
      sentBefore = sent.length
      await humanPitches(t, game, 100 + atBat * 7)
      await otherSwings(t, game, 900 - atBat * 11)
      await elapse(t, 0)
      if ((await gameRow(t, game)).status === 'final') break
    }

    expect((await gameRow(t, game)).status).toBe('final')
    await elapse(t, 200 * HOUR)
    expect(sent).toHaveLength(sentBefore)
  })
})
