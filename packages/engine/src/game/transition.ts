import { EMPTY_BASES } from '../atBat/advance'
import { type HalfInning, halfInning } from './halfInning'
import {
  type AppliedAtBat,
  DEFAULT_CONFIG,
  type GameConfig,
  type GameContext,
  GameStatus,
  Half,
  type LiveGameState,
} from './state'

/**
 * Reject a context whose lineups can't field a batting order. The pointer math
 * (`% battingOrder.length`) and leadoff seating both assume a non-empty order; an
 * empty one yields a NaN pointer / null batter that silently corrupts the live
 * state. The engine is a standalone package (ADR-0009), so it validates its own
 * input rather than trusting every caller — the Convex boundary guards this too.
 */
function assertNonEmptyBattingOrders(context: GameContext): void {
  if (!context.home.battingOrder.length || !context.away.battingOrder.length) {
    throw new Error('Both lineups need a non-empty batting order before the game can run')
  }
}

/**
 * Initialize a live game from its lineups (scheduled → live). The away team leads
 * off the top of the 1st while the home team takes the mound; both batting-order
 * pointers start at the leadoff slot and no at-bat has been folded yet.
 */
export function startGame(context: GameContext): LiveGameState {
  assertNonEmptyBattingOrders(context)
  return {
    status: GameStatus.Live,
    inning: 1,
    half: Half.Top,
    outs: 0,
    bases: EMPTY_BASES,
    homeScore: 0,
    awayScore: 0,
    homeBattingIndex: 0,
    awayBattingIndex: 0,
    currentBatter: context.away.battingOrder[0] ?? null,
    currentPitcher: context.home.pitcher,
    lastResolvedSequence: -1,
  }
}

/**
 * Fold one resolved at-bat into the live game state — the authoritative transition
 * (current state + resolved at-bat → next state). Pure and deterministic: applies
 * the recorded run/out/base deltas, advances the batting team's order pointer,
 * handles half-inning / inning flips on the third out, and resolves end-of-game
 * (walk-off, regulation, extra innings) against the configured regulation length.
 *
 * Idempotent per at-bat: an at-bat at or behind the applied marker is a no-op, so
 * re-applying the same row never double-counts. Advancing a non-live game, or an
 * out-of-order at-bat, throws.
 */
export function advance(
  state: LiveGameState,
  atBat: AppliedAtBat,
  context: GameContext,
  config: GameConfig = DEFAULT_CONFIG,
): LiveGameState {
  if (atBat.sequence <= state.lastResolvedSequence) return state // already folded in
  assertApplicable(state, atBat, context)

  const half = halfInning(state.half, context)
  const folded = foldAtBat(state, atBat, half)

  // Walk-off: the home team taking the lead in the bottom of a regulation-or-later
  // inning ends the game immediately — no further at-bats.
  if (half.battingIsHome && homeHasWon(folded, config)) return finalize(folded)

  // Mid-half: the same team stays at bat (pointer already advanced) against the
  // same pitcher.
  if (folded.outs < 3) return seatBatter(folded, half)

  // Third out — the half is over (and possibly the game).
  return endHalf(folded, context, config)
}

/**
 * Reject an at-bat that cannot be folded into this state. (The idempotent no-op
 * for an already-applied sequence is handled by the caller before this runs.)
 */
function assertApplicable(state: LiveGameState, atBat: AppliedAtBat, context: GameContext): void {
  assertNonEmptyBattingOrders(context)
  if (state.status !== GameStatus.Live) {
    throw new Error('Cannot advance a game that is not live')
  }
  if (atBat.sequence !== state.lastResolvedSequence + 1) {
    throw new Error(
      `Out-of-order at-bat: expected sequence ${state.lastResolvedSequence + 1}, got ${atBat.sequence}`,
    )
  }
  // The out delta below is only sound if the at-bat was resolved against the same
  // out count the live row holds. A mismatch would silently corrupt the total.
  if (atBat.outsBefore !== state.outs) {
    throw new Error(
      `Out count mismatch: at-bat resolved at ${atBat.outsBefore} outs, live state has ${state.outs}`,
    )
  }
}

/**
 * Apply the resolved deltas — runs to the batting team, the out delta, the new
 * bases — and advance that team's batting-order pointer (1→9, wraps; each team's
 * pointer persists across its half-innings). Inning/half/status are untouched
 * here; the end-of-half and end-of-game decisions follow in {@link advance}.
 */
function foldAtBat(state: LiveGameState, atBat: AppliedAtBat, half: HalfInning): LiveGameState {
  const priorIndex = half.battingIsHome ? state.homeBattingIndex : state.awayBattingIndex
  const nextIndex = (priorIndex + 1) % half.battingTeam.battingOrder.length
  return {
    ...state,
    homeScore: state.homeScore + (half.battingIsHome ? atBat.runsScored : 0),
    awayScore: state.awayScore + (half.battingIsHome ? 0 : atBat.runsScored),
    outs: state.outs + (atBat.outsAfter - atBat.outsBefore),
    bases: atBat.basesAfter,
    homeBattingIndex: half.battingIsHome ? nextIndex : state.homeBattingIndex,
    awayBattingIndex: half.battingIsHome ? state.awayBattingIndex : nextIndex,
    lastResolvedSequence: atBat.sequence,
  }
}

/**
 * The third out ends the current half. After the top half the home team comes to
 * bat — unless it already leads at the regulation-or-later mark, in which case the
 * bottom is never played. After the bottom half the inning is complete: a decided
 * regulation-or-later inning ends the game; a tie continues into extra innings.
 */
function endHalf(folded: LiveGameState, context: GameContext, config: GameConfig): LiveGameState {
  if (folded.half === Half.Top) {
    return homeHasWon(folded, config)
      ? finalize(folded)
      : openHalf(folded, Half.Bottom, folded.inning, context)
  }
  return isDecidedInning(folded, config)
    ? finalize(folded)
    : openHalf(folded, Half.Top, folded.inning + 1, context)
}

/**
 * Begin a fresh half-inning: reset outs/bases, set the half and inning, and seat
 * the resuming batter at the batting team's stored pointer against its pitcher.
 */
function openHalf(
  folded: LiveGameState,
  nextHalf: Half,
  inning: number,
  context: GameContext,
): LiveGameState {
  const fresh = { ...folded, half: nextHalf, inning, outs: 0, bases: EMPTY_BASES }
  return seatBatter(fresh, halfInning(nextHalf, context))
}

/** Seat the batting team's current batter against the fielding team's pitcher. */
function seatBatter(state: LiveGameState, half: HalfInning): LiveGameState {
  const index = half.battingIsHome ? state.homeBattingIndex : state.awayBattingIndex
  return {
    ...state,
    currentBatter: half.battingTeam.battingOrder.at(index) ?? null,
    currentPitcher: half.fieldingTeam.pitcher,
  }
}

/** The home team has clinched: a regulation-or-later inning in which it leads —
 * the trigger for both a bottom-inning walk-off and skipping an unneeded bottom. */
function homeHasWon(folded: LiveGameState, config: GameConfig): boolean {
  return folded.inning >= config.regulationInnings && folded.homeScore > folded.awayScore
}

/** A completed regulation-or-later inning with a leader — the game is over (an
 * extra-innings tie, by contrast, plays on). */
function isDecidedInning(folded: LiveGameState, config: GameConfig): boolean {
  return folded.inning >= config.regulationInnings && folded.homeScore !== folded.awayScore
}

/** Seal the game: no team is at bat in a finished game. */
function finalize(folded: LiveGameState): LiveGameState {
  return { ...folded, status: GameStatus.Final, currentBatter: null, currentPitcher: null }
}
