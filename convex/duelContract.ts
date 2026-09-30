import type { BaseState, GroundBallResult } from '@sandlot/engine/atBat'
import type { Half } from '@sandlot/engine/game'
import type { OutcomeBandKey } from '@sandlot/engine/outcomes'
import { ConvexError } from 'convex/values'
import type { Id } from './_generated/dataModel'

/**
 * The duel's client-facing vocabulary (SAN-57): what a commit hands back, what a
 * refused commit carries, and what the reveal query reports.
 *
 * **A leaf module on purpose.** It imports no Convex server runtime — only
 * `convex/values` and engine types — so a browser client can branch on these
 * without pulling `convex/atBat.ts` (and behind it `_generated/server`, the
 * authoritative resolver, and the participant gates) into its bundle. The vault
 * module owns the behaviour; this owns the words both sides say.
 *
 * `Id<'atBats'>` is a type-only import, so `_generated/dataModel` is erased too.
 */

/** Lifecycle of the current at-bat from the reveal query's perspective. */
export enum DuelStatus {
  AwaitingCommitments = 'awaiting_commitments',
  AwaitingOpponent = 'awaiting_opponent',
  Resolved = 'resolved',
}

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
  /** The ground-ball sub-result (SAN-16), or null for every other band. */
  groundBallResult?: GroundBallResult | null
  runsScored?: number
  rbi?: number
  outsAfter?: number
  basesAfter?: BaseState
}

/** One total per club. The read model's `ClubTotals`, restated here so this leaf
 * module stays free of the server modules (it is structurally the same type). */
interface ClubPairOf<T> {
  home: T
  away: T
}

/** A player on the field, by identity and display name. */
interface NamedPlayer {
  id: Id<'players'>
  name: string
}

/**
 * The most recently resolved at-bat, complete enough to render its reveal from
 * this alone (SAN-39): who it was between, both numbers, what it did, and the
 * board as it stood BEFORE the play.
 *
 * Both numbers are present because the at-bat is resolved — this view is built
 * from the `atBats` log, where a row exists only once both sides have locked
 * (ADR-0016). It never reads the vault, so a number committed to the NEXT at-bat
 * cannot appear in it.
 */
export interface ResolvedAtBatView {
  sequence: number
  inning: number
  half: Half
  pitcher: NamedPlayer
  batter: NamedPlayer
  pitchNumber: number
  batterNumber: number
  outcome: OutcomeBandKey
  /** The ground-ball sub-result (SAN-16), or null for every other band. */
  groundBallResult: GroundBallResult | null
  runsScored: number
  outsBefore: number
  outsAfter: number
  basesBefore: BaseState
  basesAfter: BaseState
  /** Each club's runs before this at-bat. */
  scoreBefore: ClubPairOf<number>
  /** Each club's hits before this at-bat. */
  hitsBefore: ClubPairOf<number>
  /** Whether this at-bat's out was the third, ending its half. */
  endedHalf: boolean
  /** The batting club's runs and hits in this half, through this at-bat. */
  halfTotals: { runs: number; hits: number }
}

/**
 * What a commit hands back: the at-bat it resolved, or null while only one side
 * is on file. `sequence` is the ordinal the row was logged at, so a caller can
 * confirm a later read reflects *this* at-bat rather than assuming it does — and
 * it is the same ordinal either side's commit resolves, which is what keeps
 * order-independence (ADR-0014) readable from the client.
 */
export type DuelCommitResult = {
  atBatId: Id<'atBats'>
  sequence: number
  outcome: OutcomeBandKey
} | null

/**
 * Why a commit was refused, as a category a client branches on rather than a
 * message it has to parse. The two differ in what the seat should do next, which
 * is the only distinction a caller can act on:
 *
 * **Terminal** — the commit cannot succeed as posed. The game is not live, the
 * caller does not own the club whose seat they reached for, or nobody is seated.
 *
 * **Re-enterable** — the same seat may commit again. This ordinal already holds
 * this side's number, or the number was outside the ring.
 *
 * Neither is normal flow. An out-of-range number and an empty seat are bug
 * signals: the commit screen shares `isDuelNumber` with the server, so a range
 * rejection means the screen was bypassed.
 *
 * An unauthenticated caller is refused by the shared auth gate before any of
 * these, and is deliberately uncategorised — signing in is not a duel concern
 * (SAN-38 owns that gate).
 */
/**
 * Which seat of a duel committed a number: the persisted `duelCommitments.role`
 * values, locked to `validators.duelRole` by a compile-time guard. Here rather
 * than in `./atBat` so the bot's scheduler (`./bot`) can name a seat without
 * importing the vault module it is imported by.
 */
export enum DuelRole {
  Pitching = 'pitching',
  Batting = 'batting',
}

export enum DuelRejection {
  Terminal = 'terminal',
  ReEnterable = 're-enterable',
}

/** The structured payload a refused commit carries on its `ConvexError`. The
 * `reason` is display copy for a log or a toast — never the discriminant. */
export interface DuelRejectionData {
  rejection: DuelRejection
  reason: string
}

/** Every category, read off the enum so a new one cannot be added without this
 * recognising it — a hand-listed set is a second place to remember. */
const REJECTIONS: ReadonlySet<string> = new Set<string>(Object.values(DuelRejection))

/**
 * Refuse a commit with its category attached. A `ConvexError` rather than a bare
 * `Error` because only its `data` survives the wire intact — a plain throw
 * reaches the client as a message, which is exactly what the category exists to
 * stop callers parsing.
 */
export function refuse(rejection: DuelRejection, reason: string): never {
  throw new ConvexError({ rejection, reason } satisfies DuelRejectionData)
}

/**
 * The categorised rejection an error carries, or null when it is not one. The
 * only reader of `ConvexError.data` for a duel: a caller asks this instead of
 * inspecting the payload itself, so the shape is validated in one place and an
 * error from anywhere else (a network fault, a bug, the shared auth gate) is
 * reported as "not a duel rejection" rather than mis-categorised.
 */
export function duelRejectionOf(error: unknown): DuelRejectionData | null {
  if (!(error instanceof ConvexError)) return null
  const data: unknown = error.data
  if (typeof data !== 'object' || data === null) return null
  const { rejection, reason } = data as Partial<DuelRejectionData>
  if (typeof rejection !== 'string' || !REJECTIONS.has(rejection)) return null
  return typeof reason === 'string' ? { rejection: rejection as DuelRejection, reason } : null
}
