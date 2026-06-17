import type { BaseState } from '../atBat/advance'
import {
  type AppliedAtBat,
  DEFAULT_CONFIG,
  type GameConfig,
  type GameContext,
  GameStatus,
  Half,
  type LiveGameState,
} from './state'

const EMPTY_BASES: BaseState = { first: false, second: false, third: false }

/**
 * Initialize a live game from its lineups (scheduled → live). The away team leads
 * off the top of the 1st while the home team takes the mound; both batting-order
 * pointers start at the leadoff slot and no at-bat has been folded yet.
 */
export function startGame(context: GameContext): LiveGameState {
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

  const battingIsHome = state.half === Half.Bottom
  const battingTeam = battingIsHome ? context.home : context.away
  const fieldingTeam = battingIsHome ? context.away : context.home

  // Apply the resolved deltas: runs to the batting team, the out delta, new bases.
  const homeScore = state.homeScore + (battingIsHome ? atBat.runsScored : 0)
  const awayScore = state.awayScore + (battingIsHome ? 0 : atBat.runsScored)
  const outs = state.outs + (atBat.outsAfter - atBat.outsBefore)

  // Advance the batting team's order pointer (1→9, wraps; persists per team).
  const priorIndex = battingIsHome ? state.homeBattingIndex : state.awayBattingIndex
  const nextIndex = (priorIndex + 1) % battingTeam.battingOrder.length

  const folded: LiveGameState = {
    ...state,
    homeScore,
    awayScore,
    outs,
    bases: atBat.basesAfter,
    homeBattingIndex: battingIsHome ? nextIndex : state.homeBattingIndex,
    awayBattingIndex: battingIsHome ? state.awayBattingIndex : nextIndex,
    lastResolvedSequence: atBat.sequence,
  }

  // Walk-off: the home team taking the lead in the bottom of a regulation-or-later
  // inning ends the game immediately — no further at-bats.
  if (battingIsHome && state.inning >= config.regulationInnings && homeScore > awayScore) {
    return finalize(folded)
  }

  // Mid-half: the same team stays at bat against the same pitcher.
  if (outs < 3) {
    return {
      ...folded,
      currentBatter: battingTeam.battingOrder[nextIndex] ?? null,
      currentPitcher: fieldingTeam.pitcher,
    }
  }

  // Third out — the half is over.
  return state.half === Half.Top
    ? endTopHalf(folded, context, config)
    : endInning(folded, context, config)
}

/**
 * Top half complete. If the home team already leads at the regulation-or-later
 * mark, the game is over and the bottom half is never played; otherwise the home
 * team comes to bat in the same inning.
 */
function endTopHalf(
  folded: LiveGameState,
  context: GameContext,
  config: GameConfig,
): LiveGameState {
  if (folded.inning >= config.regulationInnings && folded.homeScore > folded.awayScore) {
    return finalize(folded)
  }
  return {
    ...folded,
    half: Half.Bottom,
    outs: 0,
    bases: EMPTY_BASES,
    currentBatter: context.home.battingOrder[folded.homeBattingIndex] ?? null,
    currentPitcher: context.away.pitcher,
  }
}

/**
 * Bottom half complete — a full inning is done. A regulation-or-later inning with
 * a leader ends the game; a tie continues into extra innings (no run-limit mercy).
 */
function endInning(folded: LiveGameState, context: GameContext, config: GameConfig): LiveGameState {
  if (folded.inning >= config.regulationInnings && folded.homeScore !== folded.awayScore) {
    return finalize(folded)
  }
  return {
    ...folded,
    half: Half.Top,
    inning: folded.inning + 1,
    outs: 0,
    bases: EMPTY_BASES,
    currentBatter: context.away.battingOrder[folded.awayBattingIndex] ?? null,
    currentPitcher: context.home.pitcher,
  }
}

/** Seal the game: no team is at bat in a finished game. */
function finalize(folded: LiveGameState): LiveGameState {
  return { ...folded, status: GameStatus.Final, currentBatter: null, currentPitcher: null }
}
