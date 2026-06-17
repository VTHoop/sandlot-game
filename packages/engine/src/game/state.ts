import type { BaseState } from '../atBat/advance'

/**
 * Authoritative game-envelope types for the SAN-21 state machine. These describe
 * the live `games` row and its lifecycle, kept Convex-free so the transition
 * function stays a pure, framework-agnostic engine concern (ADR-0009). Player
 * references are opaque strings — the Convex layer maps its `Id<'players'>` onto
 * them at the boundary.
 *
 * Enums (not inline literal unions) model the finite envelope domains internally;
 * the Convex schema keeps its own string-literal validators. Each enum's *values*
 * equal those literals, so the boundary cast in `convex/game.ts` is a typed
 * relabel, never a value remap.
 */

/** Which half of the inning is being played. */
export enum Half {
  Top = 'top',
  Bottom = 'bottom',
}

/** Authoritative game lifecycle state. */
export enum GameStatus {
  Scheduled = 'scheduled',
  Live = 'live',
  Final = 'final',
}

/**
 * Regulation length of a Sandlot game: **6 innings**, not baseball's 9. This is a
 * deliberate product rule (see docs/CONTEXT.md and ADR-0017) and the single
 * source of truth for it — the end-of-game logic reads it through {@link GameConfig}.
 */
export const REGULATION_INNINGS = 6

/** Tunable game-length knob; defaults to {@link REGULATION_INNINGS}. */
export interface GameConfig {
  regulationInnings: number
}

export const DEFAULT_CONFIG: GameConfig = { regulationInnings: REGULATION_INNINGS }

/** One team's lineup: an ordered batting list (array order IS the order) + pitcher. */
export interface TeamLineup {
  battingOrder: string[]
  pitcher: string
}

/** Both lineups for a game, needed to seat batters/pitchers across transitions. */
export interface GameContext {
  home: TeamLineup
  away: TeamLineup
}

/**
 * The authoritative live game state — the fields the `games` row carries plus the
 * per-team batting-order pointers (which persist across half-innings) and the
 * applied-sequence marker that makes per-at-bat advancement idempotent.
 */
export interface LiveGameState {
  status: GameStatus
  inning: number
  half: Half
  outs: number
  bases: BaseState
  homeScore: number
  awayScore: number
  homeBattingIndex: number
  awayBattingIndex: number
  currentBatter: string | null
  currentPitcher: string | null
  lastResolvedSequence: number
}

/**
 * The slice of a resolved at-bat the envelope folds in — exactly the deltas the
 * `atBats` log records. Base-running math and the outcome itself are already
 * computed upstream (the secret at-bat round-trip, SAN-20).
 */
export interface AppliedAtBat {
  sequence: number
  outsBefore: number
  outsAfter: number
  basesAfter: BaseState
  runsScored: number
}
