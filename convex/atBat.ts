import {
  type BaseState,
  DUEL_MAX,
  DUEL_MIN,
  type HitterAttributes,
  isDuelNumber,
  type PitcherAttributes,
  resolveAtBat,
} from '@sandlot/engine/atBat'
import type { OutcomeBandKey } from '@sandlot/engine/outcomes'
import { v } from 'convex/values'
import type { Doc, Id } from './_generated/dataModel'
import { type MutationCtx, mutation, query } from './_generated/server'
import { applyResolvedAtBat } from './game'
import { assertOwns, authedUser, type Ctx, maybeUser, ownsTeam, teamsForHalf } from './participants'

/**
 * The authoritative secret at-bat round-trip (SAN-20). The server is the vault
 * and the referee: a committed number is written here and never returned by any
 * query until both sides have locked, and resolution runs server-side through
 * `@sandlot/engine` (clients never resolve authoritatively). See ADR-0016.
 *
 * Commits are order-independent (ADR-0014): either side may lock first and the
 * server resolves once both numbers are present. The only cross-player signal
 * before resolution is *that* the opponent has locked — never the number.
 *
 * Scope is one at-bat round-trip. Inning/half/status transitions, advancing the
 * batter, and score/standings rollups belong to downstream tickets — this
 * module appends the complete `atBats` row and reveals it; it does not mutate
 * the `games` row.
 */

/** Lifecycle of the current at-bat from the reveal query's perspective. */
export enum DuelStatus {
  AwaitingCommitments = 'awaiting_commitments',
  AwaitingOpponent = 'awaiting_opponent',
  Resolved = 'resolved',
}

/** Which side of the matchup an authenticated user owns, if any. The two
 * committing roles double as the persisted `duelCommitments.role` values. */
enum Participant {
  Batting = 'batting',
  Pitching = 'pitching',
  None = 'none',
}

type CommittingRole = Participant.Batting | Participant.Pitching

/**
 * Participant-facing view of the current duel. Numbers are present only once
 * both sides have locked (`status: 'resolved'`) — never while a single number
 * sits in the vault awaiting its opponent, and never for a non-participant (who
 * receives `null`). `pitchCommitted` / `swingCommitted` are the only pre-reveal
 * cross-player signal (ADR-0014): they say *that* a side has locked, never what.
 */
export interface DuelView {
  status: DuelStatus
  sequence: number
  pitchCommitted: boolean
  swingCommitted: boolean
  pitchNumber?: number
  batterNumber?: number
  outcome?: OutcomeBandKey
  runsScored?: number
  rbi?: number
  outsAfter?: number
  basesAfter?: BaseState
}

// ─── Participants (duel-specific) ───────────────────────────────────────────

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

/**
 * The current at-bat ordinal: one past the highest resolved `sequence` for the
 * game. Reads only the last row on the `by_game` index — but that read still
 * depends on the same `by_game` range we append into, so the serializable-OCC
 * one-row-per-duel guarantee below holds exactly as a full-range read would.
 */
async function currentSequence(ctx: Ctx, game: Id<'games'>): Promise<number> {
  const last = await ctx.db
    .query('atBats')
    .withIndex('by_game', (q) => q.eq('game', game))
    .order('desc')
    .first()
  return (last?.sequence ?? -1) + 1
}

function commitmentAt(
  ctx: Ctx,
  game: Id<'games'>,
  sequence: number,
  role: CommittingRole,
): Promise<Doc<'duelCommitments'> | null> {
  return ctx.db
    .query('duelCommitments')
    .withIndex('by_game', (q) => q.eq('game', game).eq('sequence', sequence).eq('role', role))
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
  if (!isDuelNumber(n)) {
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

// ─── Commit & resolve ───────────────────────────────────────────────────────

type Resolution = { atBatId: Id<'atBats'>; outcome: OutcomeBandKey } | null

/**
 * Resolve the duel at `sequence` iff BOTH sides have committed. Appends exactly
 * one complete `atBats` row and returns it; a no-op (returns `null`) while only
 * one half is on file. Idempotency / one-row-per-duel without a unique
 * constraint: the existence checks and the append both read+write the `atBats`
 * `by_game` range, so Convex's serializable OCC makes concurrent commits
 * conflict — the loser retries, re-reads, and either resolves once or is a
 * no-op. (A two-sided race resolves on whichever commit Convex serializes last.)
 */
async function tryResolve(
  ctx: MutationCtx,
  game: Doc<'games'>,
  sequence: number,
): Promise<Resolution> {
  const pitching = await commitmentAt(ctx, game._id, sequence, Participant.Pitching)
  const batting = await commitmentAt(ctx, game._id, sequence, Participant.Batting)
  if (!pitching || !batting) return null
  if (await atBatAt(ctx, game._id, sequence)) return null

  const batter = await ctx.db.get(batting.player)
  const pitcher = await ctx.db.get(pitching.player)
  if (!batter || !pitcher) throw new Error('Matchup players not found')

  const resolved = resolveAtBat({
    pitch: pitching.number,
    swing: batting.number,
    hitter: asHitter(batter.attributes),
    pitcher: asPitcher(pitcher.attributes),
    basesBefore: game.bases,
    outsBefore: game.outs,
  })

  const atBatId = await ctx.db.insert('atBats', {
    game: game._id,
    sequence,
    inning: game.inning,
    half: game.half,
    batter: batter._id,
    pitcher: pitcher._id,
    outsBefore: game.outs,
    basesBefore: game.bases,
    batterNumber: batting.number,
    pitchNumber: pitching.number,
    outcome: resolved.outcome,
    runsScored: resolved.runsScored,
    rbi: resolved.rbi,
    basesAfter: resolved.basesAfter,
    outsAfter: resolved.outsAfter,
    createdAt: Date.now(),
  })

  // Fold this at-bat into the authoritative live game state in the SAME
  // transaction as the append (ADR-0004): the log and current-state row never
  // diverge. SAN-21 owns inning/half/outs/bases/score/whose-turn + lifecycle.
  await applyResolvedAtBat(ctx, game, {
    sequence,
    outsBefore: game.outs,
    outsAfter: resolved.outsAfter,
    basesAfter: resolved.basesAfter,
    runsScored: resolved.runsScored,
  })

  return { atBatId, outcome: resolved.outcome }
}

/**
 * Seal one side's secret number for the current at-bat, then resolve if the
 * opponent is already on file. Shared by both mutations; `role` fixes which team
 * must own the caller and which seat is being committed.
 */
async function commit(
  ctx: MutationCtx,
  gameId: Id<'games'>,
  number: number,
  role: CommittingRole,
): Promise<Resolution> {
  const game = await requireLiveGame(ctx, gameId)
  const user = await authedUser(ctx)
  const { battingTeam, pitchingTeam } = teamsForHalf(game)
  await assertOwns(ctx, role === Participant.Pitching ? pitchingTeam : battingTeam, user)
  assertDuelNumber(number)

  const player = role === Participant.Pitching ? game.currentPitcher : game.currentBatter
  if (!player)
    throw new Error(`Game has no active ${role === Participant.Pitching ? 'pitcher' : 'batter'}`)

  const sequence = await currentSequence(ctx, game._id)
  if (await commitmentAt(ctx, game._id, sequence, role)) {
    throw new Error('Your number is already committed for this at-bat')
  }
  await ctx.db.insert('duelCommitments', {
    game: game._id,
    sequence,
    role,
    player,
    number,
    createdAt: Date.now(),
  })

  return tryResolve(ctx, game, sequence)
}

export const commitPitch = mutation({
  args: { game: v.id('games'), number: v.float64() },
  handler: (ctx, args) => commit(ctx, args.game, args.number, Participant.Pitching),
})

export const commitSwing = mutation({
  args: { game: v.id('games'), number: v.float64() },
  handler: (ctx, args) => commit(ctx, args.game, args.number, Participant.Batting),
})

// ─── Reveal query ───────────────────────────────────────────────────────────

function revealed(row: Doc<'atBats'>): DuelView {
  return {
    status: DuelStatus.Resolved,
    sequence: row.sequence,
    pitchCommitted: true,
    swingCommitted: true,
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
    const pitching = await commitmentAt(ctx, game._id, sequence, Participant.Pitching)
    const batting = await commitmentAt(ctx, game._id, sequence, Participant.Batting)
    // Both present would have resolved (and advanced the sequence), so at the
    // in-progress sequence at most one side is on file. While one is, the number
    // stays secret — only the "locked" booleans cross to the opponent.
    if (pitching || batting) {
      return {
        status: DuelStatus.AwaitingOpponent,
        sequence,
        pitchCommitted: pitching !== null,
        swingCommitted: batting !== null,
      }
    }
    if (sequence > 0) {
      const last = await atBatAt(ctx, game._id, sequence - 1)
      if (last) return revealed(last)
    }
    return {
      status: DuelStatus.AwaitingCommitments,
      sequence,
      pitchCommitted: false,
      swingCommitted: false,
    }
  },
})
