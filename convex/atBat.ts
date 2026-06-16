import {
  type BaseState,
  DUEL_MAX,
  DUEL_MIN,
  type HitterAttributes,
  type PitcherAttributes,
  resolveAtBat,
} from '@sandlot/engine/atBat'
import type { OutcomeBandKey } from '@sandlot/engine/outcomes'
import { v } from 'convex/values'
import type { Doc, Id } from './_generated/dataModel'
import { type MutationCtx, mutation, type QueryCtx, query } from './_generated/server'

/**
 * The authoritative secret at-bat round-trip (SAN-20). The server is the vault
 * and the referee: the pitch number is written here and never returned by any
 * query until the swing locks, and resolution runs server-side through
 * `@sandlot/engine` (clients never resolve authoritatively). See ADR-0016.
 *
 * Scope is one at-bat round-trip. Inning/half/status transitions, advancing the
 * batter, and score/standings rollups belong to downstream tickets — this
 * module appends the complete `atBats` row and reveals it; it does not mutate
 * the `games` row.
 */

type Ctx = QueryCtx | MutationCtx

/** Lifecycle of the current at-bat from the reveal query's perspective. */
export enum DuelStatus {
  AwaitingPitch = 'awaiting_pitch',
  AwaitingSwing = 'awaiting_swing',
  Resolved = 'resolved',
}

/** Which side of the matchup an authenticated user owns, if any. */
enum Participant {
  Batting = 'batting',
  Pitching = 'pitching',
  None = 'none',
}

/**
 * Participant-facing view of the current duel. Numbers are present only once the
 * swing has locked (`status: 'resolved'`) — never while a pitch sits in the
 * vault awaiting a swing, and never for a non-participant (who receives `null`).
 */
export interface DuelView {
  status: DuelStatus
  sequence: number
  pitchCommitted: boolean
  pitchNumber?: number
  batterNumber?: number
  outcome?: OutcomeBandKey
  runsScored?: number
  rbi?: number
  outsAfter?: number
  basesAfter?: BaseState
}

// ─── Auth & participants ────────────────────────────────────────────────────

function userBySubject(ctx: Ctx, subject: string): Promise<Doc<'users'> | null> {
  return ctx.db
    .query('users')
    .withIndex('by_clerk_subject', (q) => q.eq('clerkSubject', subject))
    .unique()
}

async function maybeUser(ctx: Ctx): Promise<Doc<'users'> | null> {
  const identity = await ctx.auth.getUserIdentity()
  return identity ? userBySubject(ctx, identity.subject) : null
}

async function authedUser(ctx: Ctx): Promise<Doc<'users'>> {
  const user = await maybeUser(ctx)
  if (!user) throw new Error('Not authenticated')
  return user
}

/**
 * In the top half the away team bats and the home team pitches; the bottom half
 * is the mirror. (Fielding/pitching side is the team NOT at bat.)
 */
function teamsForHalf(game: Doc<'games'>): {
  battingTeam: Id<'teams'>
  pitchingTeam: Id<'teams'>
} {
  return game.half === 'top'
    ? { battingTeam: game.awayTeam, pitchingTeam: game.homeTeam }
    : { battingTeam: game.homeTeam, pitchingTeam: game.awayTeam }
}

async function ownsTeam(ctx: Ctx, team: Id<'teams'>, user: Doc<'users'>): Promise<boolean> {
  const doc = await ctx.db.get(team)
  return doc !== null && doc.owner === user._id
}

async function assertOwns(ctx: Ctx, team: Id<'teams'>, user: Doc<'users'>): Promise<void> {
  if (!(await ownsTeam(ctx, team, user))) throw new Error('Not authorized for this team')
}

async function roleOf(ctx: Ctx, game: Doc<'games'>, user: Doc<'users'>): Promise<Participant> {
  const { battingTeam, pitchingTeam } = teamsForHalf(game)
  if (await ownsTeam(ctx, battingTeam, user)) return Participant.Batting
  if (await ownsTeam(ctx, pitchingTeam, user)) return Participant.Pitching
  return Participant.None
}

// ─── At-bat identity & lookups ──────────────────────────────────────────────

async function requireLiveGame(ctx: Ctx, id: Id<'games'>): Promise<Doc<'games'>> {
  const game = await ctx.db.get(id)
  if (!game) throw new Error('Game not found')
  if (game.status !== 'live') throw new Error('Game is not live')
  return game
}

/** The next at-bat ordinal: the count of already-resolved rows for the game. */
async function currentSequence(ctx: Ctx, game: Id<'games'>): Promise<number> {
  const rows = await ctx.db
    .query('atBats')
    .withIndex('by_game', (q) => q.eq('game', game))
    .collect()
  return rows.length
}

function pitchAt(ctx: Ctx, game: Id<'games'>, sequence: number): Promise<Doc<'pitches'> | null> {
  return ctx.db
    .query('pitches')
    .withIndex('by_game', (q) => q.eq('game', game).eq('sequence', sequence))
    .unique()
}

function atBatAt(ctx: Ctx, game: Id<'games'>, sequence: number): Promise<Doc<'atBats'> | null> {
  return ctx.db
    .query('atBats')
    .withIndex('by_game', (q) => q.eq('game', game).eq('sequence', sequence))
    .unique()
}

// ─── Validation & attribute extraction ──────────────────────────────────────

function assertDuelNumber(n: number): void {
  if (!Number.isInteger(n) || n < DUEL_MIN || n > DUEL_MAX) {
    throw new Error(`Number must be an integer in ${DUEL_MIN}–${DUEL_MAX}`)
  }
}

function asHitter(attributes: Doc<'players'>['attributes']): HitterAttributes {
  if ('power' in attributes) return attributes
  throw new Error('Current batter does not carry a hitter attribute block')
}

function asPitcher(attributes: Doc<'players'>['attributes']): PitcherAttributes {
  if ('velocity' in attributes) return attributes
  throw new Error('Current pitcher does not carry a pitcher attribute block')
}

// ─── Mutations ──────────────────────────────────────────────────────────────

export const commitPitch = mutation({
  args: { game: v.id('games'), number: v.float64() },
  handler: async (ctx, args) => {
    const game = await requireLiveGame(ctx, args.game)
    const user = await authedUser(ctx)
    const { pitchingTeam } = teamsForHalf(game)
    await assertOwns(ctx, pitchingTeam, user)
    assertDuelNumber(args.number)
    if (!game.currentPitcher) throw new Error('Game has no active pitcher')

    const sequence = await currentSequence(ctx, game._id)
    if (await pitchAt(ctx, game._id, sequence)) {
      throw new Error('A pitch is already committed for this at-bat')
    }
    await ctx.db.insert('pitches', {
      game: game._id,
      sequence,
      pitcher: game.currentPitcher,
      number: args.number,
      createdAt: Date.now(),
    })
  },
})

export const commitSwing = mutation({
  args: { game: v.id('games'), number: v.float64() },
  handler: async (ctx, args) => {
    const game = await requireLiveGame(ctx, args.game)
    const user = await authedUser(ctx)
    const { battingTeam } = teamsForHalf(game)
    await assertOwns(ctx, battingTeam, user)
    assertDuelNumber(args.number)

    const sequence = await currentSequence(ctx, game._id)
    const pitch = await pitchAt(ctx, game._id, sequence)
    if (!pitch) throw new Error('No pitch on file for this at-bat (pitch must come first)')

    if (!game.currentBatter || !game.currentPitcher) throw new Error('Game has no active matchup')
    const batter = await ctx.db.get(game.currentBatter)
    const pitcher = await ctx.db.get(game.currentPitcher)
    if (!batter || !pitcher) throw new Error('Matchup players not found')

    const resolved = resolveAtBat({
      pitch: pitch.number,
      swing: args.number,
      hitter: asHitter(batter.attributes),
      pitcher: asPitcher(pitcher.attributes),
      basesBefore: game.bases,
      outsBefore: game.outs,
    })

    // Append-only: exactly one complete row per duel. A second (sequential)
    // swing finds the sequence advanced and no pending pitch, so it is rejected
    // above. Concurrent swings are safe too: `currentSequence` reads the atBats
    // `by_game` range and this insert writes into it, so Convex's serializable
    // OCC detects the conflict and retries the loser — which then re-derives the
    // advanced sequence and is rejected. No unique constraint is required.
    const atBatId = await ctx.db.insert('atBats', {
      game: game._id,
      sequence,
      inning: game.inning,
      half: game.half,
      batter: batter._id,
      pitcher: pitcher._id,
      outsBefore: game.outs,
      basesBefore: game.bases,
      batterNumber: args.number,
      pitchNumber: pitch.number,
      outcome: resolved.outcome,
      runsScored: resolved.runsScored,
      rbi: resolved.rbi,
      basesAfter: resolved.basesAfter,
      outsAfter: resolved.outsAfter,
      createdAt: Date.now(),
    })
    return { atBatId, outcome: resolved.outcome }
  },
})

// ─── Reveal query ───────────────────────────────────────────────────────────

function revealed(row: Doc<'atBats'>): DuelView {
  return {
    status: DuelStatus.Resolved,
    sequence: row.sequence,
    pitchCommitted: true,
    pitchNumber: row.pitchNumber,
    batterNumber: row.batterNumber,
    outcome: row.outcome,
    runsScored: row.runsScored,
    rbi: row.rbi,
    outsAfter: row.outsAfter,
    basesAfter: row.basesAfter,
  }
}

export const getActiveDuel = query({
  args: { game: v.id('games') },
  handler: async (ctx, args): Promise<DuelView | null> => {
    const game = await ctx.db.get(args.game)
    if (!game) return null
    const user = await maybeUser(ctx)
    // Non-participants (incl. the unauthenticated) can read neither number.
    if (!user || (await roleOf(ctx, game, user)) === Participant.None) return null

    const sequence = await currentSequence(ctx, game._id)
    if (await pitchAt(ctx, game._id, sequence)) {
      // A pitch is vaulted but the swing has not locked — the number stays secret.
      return { status: DuelStatus.AwaitingSwing, sequence, pitchCommitted: true }
    }
    if (sequence > 0) {
      const last = await atBatAt(ctx, game._id, sequence - 1)
      if (last) return revealed(last)
    }
    return { status: DuelStatus.AwaitingPitch, sequence, pitchCommitted: false }
  },
})
