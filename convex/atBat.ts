import {
  type BaseSpeeds,
  type BaseState,
  DUEL_MAX,
  DUEL_MIN,
  type HitterAttributes,
  isDuelNumber,
  type PitcherAttributes,
  resolveAtBat,
  SwingType,
} from '@sandlot/engine/atBat'
import type { OutcomeBandKey } from '@sandlot/engine/outcomes'
import { v } from 'convex/values'
import type { Doc, Id } from './_generated/dataModel'
import { type MutationCtx, mutation, query } from './_generated/server'
import { applyResolvedAtBat } from './game'
import { assertOwns, authedUser, type Ctx, maybeUser, ownsTeam, teamsForHalf } from './participants'
import { swingType as swingTypeValidator } from './validators'

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
 * Scope is one at-bat round-trip. Once both numbers land, resolution appends the
 * complete `atBats` row and, in the SAME transaction, folds it into the live
 * `games` row via `game.applyResolvedAtBat` (SAN-21) — so the log and the live
 * envelope never diverge (ADR-0004). Standings/box-score rollups still belong to
 * downstream tickets.
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

/** Contact a bunting pitcher is granted by the §3.4.3 "bunt bonus". */
const PITCHER_BUNT_CONTACT = 4

/**
 * The hitter block the engine sees for this swing. A normal hitter uses their own
 * block. The "bunt bonus" (Rules §3.4.3) is a boundary INPUT adjustment, not engine
 * logic (the engine stays roster-free, ADR-0009): a pitcher carries no hitter
 * block, so when one bunts we synthesize a hitter with contact raised to 4 and the
 * floor (1) elsewhere. A pitcher swinging normally is still unsupported (out of
 * SAN-17 scope) — the bonus is the only pitcher-as-batter path wired here.
 */
function hitterForSwing(
  attributes: Doc<'players'>['attributes'],
  swingType: SwingType,
): HitterAttributes {
  if ('power' in attributes) return attributes
  if (swingType === SwingType.Bunt) {
    return { power: 1, contact: PITCHER_BUNT_CONTACT, speed: 1, eye: 1 }
  }
  throw new Error('Current batter does not carry a hitter attribute block')
}

function asPitcher(attributes: Doc<'players'>['attributes']): PitcherAttributes {
  if ('velocity' in attributes) return attributes
  throw new Error('Current pitcher does not carry a pitcher attribute block')
}

/** A runner's 1–5 speed for the GB speed axis; a pitcher-as-runner is the slowest (1, SAN-16). */
function runnerSpeed(attributes: Doc<'players'>['attributes']): number {
  return 'power' in attributes ? attributes.speed : 1
}

/**
 * Look up each on-base runner's speed for the GB sub-resolution, positionally
 * aligned to `bases` (null where empty). The engine consumes this block rather
 * than a roster handle (ADR-0009); the pitcher-as-runner default lives here.
 */
async function runnerSpeedsFor(
  ctx: MutationCtx,
  bases: Doc<'games'>['bases'],
): Promise<BaseSpeeds> {
  const speedAt = async (id: Id<'players'> | null): Promise<number | null> => {
    if (!id) return null
    const player = await ctx.db.get(id)
    return player ? runnerSpeed(player.attributes) : null
  }
  // Independent lookups — resolve them concurrently rather than serializing
  // three round-trips on a loaded base.
  const [first, second, third] = await Promise.all([
    speedAt(bases.first),
    speedAt(bases.second),
    speedAt(bases.third),
  ])
  return { first, second, third }
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

  // The batter's swing declaration is public (announced with the swing, §3.4), so
  // it travels on the batting commitment; a missing field is a normal swing. The
  // persisted literal equals the engine enum's value (guarded in ./validators).
  const swingType = (batting.swingType ?? SwingType.Normal) as SwingType
  const resolved = resolveAtBat({
    pitch: pitching.number,
    swing: batting.number,
    hitter: hitterForSwing(batter.attributes, swingType), // applies the §3.4.3 bunt bonus
    pitcher: asPitcher(pitcher.attributes),
    basesBefore: game.bases,
    outsBefore: game.outs,
    batter: batter._id, // seated on base when the outcome reaches base (SAN-44)
    runnerSpeeds: await runnerSpeedsFor(ctx, game.bases), // GB speed axis (SAN-16)
    swingType,
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
    // GB sub-result (SAN-16) or null for non-GB; the engine enum's string values
    // are exactly the persisted literals, so the relabel is sound (cf. basesAfter).
    groundBallResult: resolved.groundBallResult as Doc<'atBats'>['groundBallResult'],
    // Bunt swing-mode (SAN-17): the declaration + the bunt sub-result (null for a
    // normal swing). The engine enum's string values are exactly the persisted
    // literals, so the relabel is sound (cf. groundBallResult).
    swingType: swingType as Doc<'atBats'>['swingType'],
    buntResult: resolved.buntResult as Doc<'atBats'>['buntResult'],
    runsScored: resolved.runsScored,
    rbi: resolved.rbi,
    // Engine bases hold opaque runner ids that all originate from this game's
    // lineups (or null), so the relabel back to `Id<'players'>` is sound.
    basesAfter: resolved.basesAfter as Doc<'atBats'>['basesAfter'],
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
  swingType?: SwingType,
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
    // Only a batting commitment carries a declaration; a normal swing omits it.
    ...(swingType && role === Participant.Batting ? { swingType } : {}),
    createdAt: Date.now(),
  })

  return tryResolve(ctx, game, sequence)
}

export const commitPitch = mutation({
  args: { game: v.id('games'), number: v.float64() },
  handler: (ctx, args) => commit(ctx, args.game, args.number, Participant.Pitching),
})

export const commitSwing = mutation({
  // `swingType` is the public bunt declaration (SAN-17); omitted ≡ a normal swing.
  // The validator literal union equals the engine enum's string values (guarded in
  // ./validators), so the relabel to `SwingType` is sound.
  args: { game: v.id('games'), number: v.float64(), swingType: v.optional(swingTypeValidator) },
  handler: (ctx, args) =>
    commit(
      ctx,
      args.game,
      args.number,
      Participant.Batting,
      args.swingType as SwingType | undefined,
    ),
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
