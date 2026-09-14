// @vitest-environment edge-runtime
/// <reference types="vite/client" />
import { GameStatus, Half } from '@sandlot/engine/game'
import { convexTest } from 'convex-test'
import { describe, expect, it } from 'vitest'
import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import { DuelRejection, DuelStatus } from '../../../convex/duelContract'
import schema from '../../../convex/schema'
import {
  type ConvexDuelAdapter,
  createConvexDuelAdapter,
  DuelCommitError,
  type DuelGateway,
} from './convexAdapter'
import { playHalfInning, type RevealGate } from './duelLoop'
import { FieldSpot } from './scenario'
import { DuelSeat, type SeatAgent } from './seatAgent'

/**
 * The Convex-backed adapter against a real Convex backend (SAN-57). It lives in
 * the `edge-runtime` environment with `convex-test` rather than beside the pure
 * adapter's jsdom suite, because the thing under test IS the round trip: a fake
 * gateway would assert only that the adapter calls the functions it was written
 * to call, which is the one claim that cannot fail.
 *
 * Hotseat throughout (`docs/ROADMAP.md`): one owner holds both clubs and drives
 * both seats, which is exactly what the dev seed produces.
 */

// convex-test discovers the function modules; exclude the test files themselves.
const modules = import.meta.glob(['../../../convex/**/*.ts', '!../../../convex/**/*.test.ts'])

/** The hotseat manager, holding both clubs. */
const MANAGER = { subject: 'hotseat-manager' }
/** A signed-in account holding neither club. */
const STRANGER = { subject: 'stranger' }

const EMPTY_BASES = { first: null, second: null, third: null }

const HITTER = { source: 'custom', role: 'hitter', position: 'CF', price: null } as const
const ARM = { source: 'custom', role: 'pitcher', position: 'P', price: null } as const

/** Neutral blocks: the duel resolves off the difference alone, so the numbers
 * below land in a known band. Distinct per seat so an assertion cannot pass by
 * reading the wrong player's attributes. */
const AWAY_LEADOFF_ATTRS = { power: 3, contact: 3, speed: 3, eye: 3 } as const
const AWAY_SECOND_ATTRS = { power: 3, contact: 3, speed: 4, eye: 3 } as const
const HOME_LEADOFF_ATTRS = { power: 3, contact: 3, speed: 2, eye: 3 } as const
const HOME_SECOND_ATTRS = { power: 3, contact: 3, speed: 5, eye: 3 } as const
const ARM_ATTRS = { velocity: 3, movement: 3, awareness: 3, command: 3 } as const

/** An exact match on the ring of 999 is a home run (ADR-0016). */
const HOME_RUN = { pitch: 500, swing: 500 }
/** The widest reachable difference is the worst band for the batter. */
const STRIKEOUT = { pitch: 1, swing: 500 }
/** The bottom of the GB band for a neutral matchup: the batter is out at first
 * and a runner on first advances (GO_RA) — pinned in `convex/atBat.test.ts`. */
const GROUND_BALL = { pitch: 1, swing: 273 }

interface Seed {
  game: Id<'games'>
  awayLeadoff: Id<'players'>
  awaySecond: Id<'players'>
  homeLeadoff: Id<'players'>
  homeSecond: Id<'players'>
  awayPitcher: Id<'players'>
  homePitcher: Id<'players'>
}

/** A live game with both clubs under one owner, opened through `startGame`. */
async function seedLiveGame() {
  const t = convexTest(schema, modules)
  const ids = await t.run(async (ctx): Promise<Seed> => {
    const manager = await ctx.db.insert('users', {
      clerkSubject: MANAGER.subject,
      displayName: 'Manager',
    })
    await ctx.db.insert('users', { clerkSubject: STRANGER.subject, displayName: 'Stranger' })

    const homeTeam = await ctx.db.insert('teams', { owner: manager, name: 'Ridgeview Rail' })
    const awayTeam = await ctx.db.insert('teams', { owner: manager, name: 'Harbor Kingfishers' })

    const players = {
      awayLeadoff: await ctx.db.insert('players', {
        name: 'R. VANCE',
        ...HITTER,
        attributes: AWAY_LEADOFF_ATTRS,
      }),
      awaySecond: await ctx.db.insert('players', {
        name: 'T. JULIEN',
        ...HITTER,
        attributes: AWAY_SECOND_ATTRS,
      }),
      homeLeadoff: await ctx.db.insert('players', {
        name: 'J. WHITLOCK',
        ...HITTER,
        attributes: HOME_LEADOFF_ATTRS,
      }),
      homeSecond: await ctx.db.insert('players', {
        name: 'Q. BAKER',
        ...HITTER,
        attributes: HOME_SECOND_ATTRS,
      }),
      awayPitcher: await ctx.db.insert('players', {
        name: 'G. PIKE',
        ...ARM,
        attributes: ARM_ATTRS,
      }),
      homePitcher: await ctx.db.insert('players', {
        name: 'H. MARSH',
        ...ARM,
        attributes: ARM_ATTRS,
      }),
    }

    const game = await ctx.db.insert('games', {
      homeTeam,
      awayTeam,
      inning: 1,
      half: 'top',
      outs: 0,
      bases: EMPTY_BASES,
      homeScore: 0,
      awayScore: 0,
      status: 'scheduled',
      currentBatter: null,
      currentPitcher: null,
      homeBattingIndex: 0,
      awayBattingIndex: 0,
      lastResolvedSequence: -1,
    })
    await ctx.db.insert('lineups', {
      game,
      team: awayTeam,
      battingOrder: [
        { player: players.awayLeadoff, position: 'CF' },
        { player: players.awaySecond, position: 'SS' },
      ],
      pitcher: players.awayPitcher,
    })
    await ctx.db.insert('lineups', {
      game,
      team: homeTeam,
      battingOrder: [
        { player: players.homeLeadoff, position: 'CF' },
        { player: players.homeSecond, position: 'SS' },
      ],
      pitcher: players.homePitcher,
    })
    return { game, ...players }
  })
  await t.withIdentity(MANAGER).mutation(api.game.startGame, { game: ids.game })
  return { t, ...ids }
}

type Harness = Awaited<ReturnType<typeof seedLiveGame>>['t']

/**
 * The gateway the real client will hand the adapter, with the game id bound: one
 * query per read and one mutation per seat. Nothing here interprets a result —
 * translation is the adapter's job, which is what these tests are about.
 */
function gatewayFor(t: Harness, identity: { subject: string }, game: Id<'games'>): DuelGateway {
  const as = t.withIdentity(identity)
  return {
    readGame: () => as.query(api.gameView.getGame, { game }),
    readDuel: () => as.query(api.atBat.getActiveDuel, { game }),
    commitPitch: (number) => as.mutation(api.atBat.commitPitch, { game, number }),
    commitSwing: (number) => as.mutation(api.atBat.commitSwing, { game, number }),
  }
}

const adapterFor = (t: Harness, game: Id<'games'>): Promise<ConvexDuelAdapter> =>
  createConvexDuelAdapter(gatewayFor(t, MANAGER, game))

/** The rejection category a refused `playAtBat` carried. Fails loudly on a call
 * that succeeded, and on an error that is not a categorised rejection. */
async function rejectionOf(call: Promise<unknown>): Promise<DuelRejection> {
  try {
    await call
  } catch (error) {
    if (error instanceof DuelCommitError) return error.rejection
    throw error
  }
  throw new Error('expected the commit to be rejected, but it was accepted')
}

describe('the Convex-backed adapter — opening on a game', () => {
  it('reads the opening situation off the server, not off a local fixture', async () => {
    const { t, game, awayLeadoff, homePitcher } = await seedLiveGame()

    const adapter = await adapterFor(t, game)

    expect(adapter.state()).toMatchObject({
      status: GameStatus.Live,
      inning: 1,
      half: Half.Top,
      outs: 0,
      bases: EMPTY_BASES,
      homeScore: 0,
      awayScore: 0,
      currentBatter: awayLeadoff,
      currentPitcher: homePitcher,
    })
    expect(adapter.hits()).toEqual({ you: 0, opp: 0 })
  })

  it('refuses a game it cannot read rather than opening on an empty snapshot', async () => {
    const { t, game } = await seedLiveGame()

    // A signed-in account holding neither club reads `null` — indistinguishable
    // from a game that is not there, and not something to paper over.
    await expect(createConvexDuelAdapter(gatewayFor(t, STRANGER, game))).rejects.toThrow()
  })

  it('refuses a game that has not been started', async () => {
    const { t, game } = await seedLiveGame()
    await t.run((ctx) => ctx.db.patch(game, { status: 'scheduled' }))

    await expect(adapterFor(t, game)).rejects.toThrow()
  })

  it('resolves the roster at the boundary, defaulting a pitcher-as-runner to the slowest', async () => {
    const { t, game, awayLeadoff, homePitcher } = await seedLiveGame()

    const roster = (await adapterFor(t, game)).roster()

    // The hitter carries their own base-running speed; the pitcher is forced to
    // 1 (SAN-16) because a pitcher's block has no speed to read.
    expect(roster.get(awayLeadoff)).toMatchObject({ name: 'R. VANCE', speed: 3 })
    expect(roster.get(homePitcher)).toMatchObject({ name: 'H. MARSH', speed: 1 })
  })

  it('builds the matchup card from the server, due up included', async () => {
    const { t, game } = await seedLiveGame()

    const matchup = (await adapterFor(t, game)).matchup()

    expect(matchup.you.pitcher).toEqual({ name: 'H. MARSH', attrs: { VEL: 3, MOV: 3, CMD: 3 } })
    expect(matchup.you.batter).toEqual({
      name: 'R. VANCE',
      attrs: { PWR: 3, CON: 3, SPD: 3, EYE: 3 },
    })
    // The order is two deep and the leadoff man is up, so it wraps back to him.
    expect(matchup.you.dueUp).toEqual(['T. JULIEN', 'R. VANCE'])
  })
})

describe('the Convex-backed adapter — one at-bat', () => {
  it('commits both seats and reveals the server’s resolved outcome', async () => {
    const { t, game } = await seedLiveGame()
    const adapter = await adapterFor(t, game)

    const { reveal, applied } = await adapter.playAtBat(HOME_RUN.pitch, HOME_RUN.swing)

    expect(reveal).toMatchObject({
      outcome: 'HR',
      headline: 'HOME RUN!',
      you: HOME_RUN.swing,
      them: HOME_RUN.pitch,
      opponent: 'H. MARSH',
      inning: 1,
      half: 'TOP',
      outs: 0,
      runsScored: 1,
      scoreBefore: { you: 0, opp: 0 },
      hitsBefore: { you: 0, opp: 0 },
    })
    expect(applied).toMatchObject({ sequence: 0, outsBefore: 0, outsAfter: 0, runsScored: 1 })
  })

  it('writes the at-bat exactly once, through the mutation and not the client', async () => {
    const { t, game } = await seedLiveGame()
    const adapter = await adapterFor(t, game)

    await adapter.playAtBat(HOME_RUN.pitch, HOME_RUN.swing)

    const rows = await t.run((ctx) =>
      ctx.db
        .query('atBats')
        .withIndex('by_game', (q) => q.eq('game', game))
        .collect(),
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      sequence: 0,
      pitchNumber: HOME_RUN.pitch,
      batterNumber: HOME_RUN.swing,
      outcome: 'HR',
    })
  })

  it('does not settle until the cached snapshot reflects the at-bat it resolved', async () => {
    const { t, game, awaySecond } = await seedLiveGame()
    const adapter = await adapterFor(t, game)

    await adapter.playAtBat(HOME_RUN.pitch, HOME_RUN.swing)

    // Read with no further await: the loop re-reads `state()` twice immediately
    // after `playAtBat`, and a pre-commit snapshot there would re-seat the same
    // batter and commit the at-bat a second time.
    expect(adapter.state().currentBatter).toBe(awaySecond)
    expect(adapter.state().awayScore).toBe(1)
    expect(adapter.hits()).toEqual({ you: 1, opp: 0 })
    expect(adapter.matchup().you.batter.name).toBe('T. JULIEN')
  })

  it('renders the ground-ball sub-result, not just the band', async () => {
    const { t, game, awaySecond } = await seedLiveGame()
    await t.run((ctx) =>
      ctx.db.patch(game, { bases: { first: awaySecond, second: null, third: null } }),
    )
    const adapter = await adapterFor(t, game)

    const { reveal } = await adapter.playAtBat(GROUND_BALL.pitch, GROUND_BALL.swing)

    expect(reveal.outcome).toBe('GB')
    expect(reveal.headline).toBe('GROUNDOUT')
    // The runner advances; the batter is out AT first, because a ground ball is a
    // force play — which the band alone could not have said.
    expect(reveal.movements).toEqual([
      { from: FieldSpot.First, to: FieldSpot.Second, retired: false },
      { from: FieldSpot.Batter, to: FieldSpot.First, retired: true },
    ])
  })
})

describe('the Convex-backed adapter — order independence', () => {
  it('leaves the snapshot alone while only one side is on file', async () => {
    const { t, game, awayLeadoff } = await seedLiveGame()
    const adapter = await adapterFor(t, game)

    // The opponent locks out of band; nothing resolves, so nothing advances.
    const pending = await gatewayFor(t, MANAGER, game).commitPitch(HOME_RUN.pitch)
    expect(pending).toBeNull()

    await adapter.refresh()
    expect(adapter.state().currentBatter).toBe(awayLeadoff)
    expect(adapter.state().awayScore).toBe(0)
  })

  it('refuses when the duel resolved before its own swing was committed', async () => {
    const { t, game } = await seedLiveGame()
    const adapter = await adapterFor(t, game)

    // A swing already on file means the adapter's pitch commit resolves the
    // at-bat, leaving the swing it holds with no ordinal to land on. Committing
    // it anyway would seal the NEXT at-bat with a number nobody chose for it.
    await gatewayFor(t, MANAGER, game).commitSwing(HOME_RUN.swing)

    await expect(adapter.playAtBat(HOME_RUN.pitch, HOME_RUN.swing)).rejects.toThrow()
  })
})

describe('the Convex-backed adapter — rejections carry their category', () => {
  it('reports a game that is no longer live as terminal', async () => {
    const { t, game } = await seedLiveGame()
    const adapter = await adapterFor(t, game)
    await t.run((ctx) => ctx.db.patch(game, { status: 'final' }))

    expect(await rejectionOf(adapter.playAtBat(HOME_RUN.pitch, HOME_RUN.swing))).toBe(
      DuelRejection.Terminal,
    )
  })

  it('reports a club the caller does not own as terminal', async () => {
    const { t, game } = await seedLiveGame()
    const adapter = await createConvexDuelAdapter(gatewayFor(t, MANAGER, game))
    // The manager is re-pointed off both clubs after the adapter opened — the
    // shape SAN-62's dev assignment can produce mid-session.
    await t.run(async (ctx) => {
      const other = await ctx.db.insert('users', { clerkSubject: 'other', displayName: 'O' })
      const row = await ctx.db.get(game)
      if (row) {
        await ctx.db.patch(row.homeTeam, { owner: other })
        await ctx.db.patch(row.awayTeam, { owner: other })
      }
    })

    expect(await rejectionOf(adapter.playAtBat(HOME_RUN.pitch, HOME_RUN.swing))).toBe(
      DuelRejection.Terminal,
    )
  })

  it('reports an empty seat as terminal', async () => {
    const { t, game } = await seedLiveGame()
    const adapter = await adapterFor(t, game)
    await t.run((ctx) => ctx.db.patch(game, { currentPitcher: null }))

    expect(await rejectionOf(adapter.playAtBat(HOME_RUN.pitch, HOME_RUN.swing))).toBe(
      DuelRejection.Terminal,
    )
  })

  it('reports a number outside the ring as re-enterable', async () => {
    const { t, game } = await seedLiveGame()
    const adapter = await adapterFor(t, game)

    // The commit screen shares `isDuelNumber` with the server, so reaching this
    // means the screen was bypassed — a bug signal, but the seat may re-enter.
    expect(await rejectionOf(adapter.playAtBat(1000, HOME_RUN.swing))).toBe(
      DuelRejection.ReEnterable,
    )
  })

  it('reports a seat that has already locked at this ordinal as re-enterable', async () => {
    const { t, game } = await seedLiveGame()
    const adapter = await adapterFor(t, game)
    await gatewayFor(t, MANAGER, game).commitPitch(HOME_RUN.pitch)

    expect(await rejectionOf(adapter.playAtBat(HOME_RUN.pitch, HOME_RUN.swing))).toBe(
      DuelRejection.ReEnterable,
    )
  })

  it('leaves an error that is not a categorised rejection alone', async () => {
    const { t, game } = await seedLiveGame()
    const failing: DuelGateway = {
      ...gatewayFor(t, MANAGER, game),
      commitPitch: () => Promise.reject(new Error('socket closed')),
    }
    const adapter = await createConvexDuelAdapter(failing)

    // Mis-categorising a transport failure as a game rule would be worse than
    // not categorising it: the Convex client retries a dropped mutation itself.
    await expect(adapter.playAtBat(HOME_RUN.pitch, HOME_RUN.swing)).rejects.toThrow('socket closed')
  })
})

describe('the Convex-backed adapter — snapshot coherence', () => {
  /** The real gateway with one read doctored — what a lagging subscription, or a
   * read served from an older view, would hand the adapter. */
  const withDuelRead = (
    t: Harness,
    game: Id<'games'>,
    readDuel: DuelGateway['readDuel'],
  ): DuelGateway => ({ ...gatewayFor(t, MANAGER, game), readDuel })

  it('refuses a read that does not reflect the at-bat it just resolved', async () => {
    const { t, game } = await seedLiveGame()
    const adapter = await createConvexDuelAdapter(
      withDuelRead(t, game, () =>
        Promise.resolve({
          status: DuelStatus.AwaitingCommitments,
          sequence: 0,
          pitchCommitted: false,
          swingCommitted: false,
        }),
      ),
    )

    // Returning here would hand the loop a reveal for an at-bat the read cannot
    // confirm happened — worse than failing, because the loop would carry on.
    await expect(adapter.playAtBat(HOME_RUN.pitch, HOME_RUN.swing)).rejects.toThrow(/at-bat 0/)
  })

  it('refuses a resolved read that is missing part of its outcome', async () => {
    const { t, game } = await seedLiveGame()
    const adapter = await createConvexDuelAdapter(
      withDuelRead(t, game, () =>
        Promise.resolve({
          status: DuelStatus.Resolved,
          sequence: 0,
          pitchCommitted: true,
          swingCommitted: true,
          pitchNumber: HOME_RUN.pitch,
          batterNumber: HOME_RUN.swing,
          // No `outcome`: the reveal has nothing to shout, and guessing one would
          // show the player a result the server never produced.
          runsScored: 1,
          outsAfter: 0,
          basesAfter: EMPTY_BASES,
        }),
      ),
    )

    await expect(adapter.playAtBat(HOME_RUN.pitch, HOME_RUN.swing)).rejects.toThrow(/outcome/)
  })
})

describe('the Convex-backed adapter — a game that ends', () => {
  /** Bottom of the 6th, tied: the home club taking the lead is a walk-off. */
  async function seedWalkOff() {
    const seeded = await seedLiveGame()
    await seeded.t.run((ctx) =>
      ctx.db.patch(seeded.game, {
        inning: 6,
        half: 'bottom',
        currentBatter: seeded.homeLeadoff,
        currentPitcher: seeded.awayPitcher,
      }),
    )
    return seeded
  }

  it('carries the last live situation into the final snapshot, seating nobody', async () => {
    const { t, game } = await seedWalkOff()
    const adapter = await adapterFor(t, game)

    const { reveal } = await adapter.playAtBat(HOME_RUN.pitch, HOME_RUN.swing)

    expect(reveal).toMatchObject({ outcome: 'HR', half: 'BOTTOM', inning: 6, runsScored: 1 })
    // The final read carries no inning, outs or seats — a finished game has none
    // — so the snapshot holds where the last out left it, with nobody seated.
    expect(adapter.state()).toMatchObject({
      status: GameStatus.Final,
      inning: 6,
      half: Half.Bottom,
      homeScore: 1,
      awayScore: 0,
      currentBatter: null,
      currentPitcher: null,
    })
    expect(adapter.hits()).toEqual({ you: 1, opp: 0 })
  })

  it('refuses a further at-bat without reaching the server for one', async () => {
    const { t, game } = await seedWalkOff()
    const adapter = await adapterFor(t, game)
    await adapter.playAtBat(HOME_RUN.pitch, HOME_RUN.swing)

    // The snapshot already says the game is over, so there is nothing to ask.
    await expect(adapter.playAtBat(HOME_RUN.pitch, HOME_RUN.swing)).rejects.toThrow(/not live/)
    const rows = await t.run((ctx) =>
      ctx.db
        .query('duelCommitments')
        .withIndex('by_game', (q) => q.eq('game', game))
        .collect(),
    )
    expect(rows).toHaveLength(2) // the walk-off's pair, and nothing after it
  })
})

describe('the Convex-backed adapter — driving the real loop', () => {
  /** Both seats answered from one fixed pair; the gate advances itself. */
  const agents = (pitch: number, swing: number) => ({
    [DuelSeat.Pitcher]: { requestNumber: () => Promise.resolve(pitch) } satisfies SeatAgent,
    [DuelSeat.Batter]: { requestNumber: () => Promise.resolve(swing) } satisfies SeatAgent,
  })
  const openGate: RevealGate = { present: () => Promise.resolve() }

  it('plays a half-inning to the third out through playHalfInning', async () => {
    const { t, game } = await seedLiveGame()
    const adapter = await adapterFor(t, game)

    const summary = await playHalfInning(
      adapter,
      adapter.roster(),
      agents(STRIKEOUT.pitch, STRIKEOUT.swing),
      openGate,
    )

    expect(summary).toMatchObject({ half: 'TOP', inning: 1, runs: 0, hits: 0 })
    // Exactly three at-bats — one per out, with no duplicate commits.
    const rows = await t.run((ctx) =>
      ctx.db
        .query('atBats')
        .withIndex('by_game', (q) => q.eq('game', game))
        .collect(),
    )
    expect(rows.map((row) => row.sequence)).toEqual([0, 1, 2])
    expect(adapter.state().half).toBe(Half.Bottom)
  })

  it('flips the hit totals to the incoming batting side when the half turns', async () => {
    const { t, game } = await seedLiveGame()
    const adapter = await adapterFor(t, game)

    // One away hit, then three outs to end the top half.
    await adapter.playAtBat(HOME_RUN.pitch, HOME_RUN.swing)
    expect(adapter.hits()).toEqual({ you: 1, opp: 0 })
    await playHalfInning(
      adapter,
      adapter.roster(),
      agents(STRIKEOUT.pitch, STRIKEOUT.swing),
      openGate,
    )

    // The home club bats the bottom, so its own total is "you" and the away
    // club's hit carries as "opp" — the same flip `rollHitTotals` keeps.
    expect(adapter.state().half).toBe(Half.Bottom)
    expect(adapter.hits()).toEqual({ you: 0, opp: 1 })

    const { reveal } = await adapter.playAtBat(HOME_RUN.pitch, HOME_RUN.swing)
    expect(reveal.hitsBefore).toEqual({ you: 0, opp: 1 })
    expect(reveal.half).toBe('BOTTOM')
    expect(reveal.opponent).toBe('G. PIKE') // the away club now takes the mound
  })

  it('keeps the roster current as the seats change', async () => {
    const { t, game, homeLeadoff, awayPitcher } = await seedLiveGame()
    const adapter = await adapterFor(t, game)
    const roster = adapter.roster()

    await playHalfInning(adapter, roster, agents(STRIKEOUT.pitch, STRIKEOUT.swing), openGate)

    // `playHalfInning` takes the roster handle once, so it has to still resolve
    // the players the bottom half seats.
    expect(roster.get(homeLeadoff)?.name).toBe('J. WHITLOCK')
    expect(roster.get(awayPitcher)?.name).toBe('G. PIKE')
  })
})
