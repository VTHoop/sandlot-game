import type { BaseSpeeds, BaseState, RunnerId } from '@sandlot/engine/atBat'
import type { AppliedAtBat, GameContext, LiveGameState } from '@sandlot/engine/game'
import type { OutcomeBandKey } from '@sandlot/engine/outcomes'
import type { OutcomeKey } from '../../components/ui/OutcomeLadder'
import type { Roster } from './roster'
import type { RevealScenario } from './scenario'

/**
 * The pure, headless duel adapter (SAN-45) — red checkpoint: signatures only.
 * Implementation lands in the next commit (TDD red → green).
 */

export interface HitTotals {
  you: number
  opp: number
}

export interface DuelResolution {
  applied: AppliedAtBat
  reveal: RevealScenario
}

export interface DuelAdapter {
  state(): LiveGameState
  hits(): HitTotals
  playAtBat(pitch: number, swing: number): DuelResolution
}

const TODO = (): never => {
  throw new Error('SAN-45 duel adapter not yet implemented')
}

export const OUTCOME_KEY_BY_BAND: Record<OutcomeBandKey, OutcomeKey> = TODO()

export function assembleRunnerSpeeds(_bases: BaseState, _roster: Roster): BaseSpeeds {
  return TODO()
}

export function toOutcomeKey(_band: OutcomeBandKey): OutcomeKey {
  return TODO()
}

export function deriveScoreline(_params: {
  outcome: OutcomeKey
  basesAfter: BaseState
  runsScored: number
  batter: RunnerId
}): string {
  return TODO()
}

export function accumulateHits(_hits: HitTotals, _outcome: OutcomeKey): HitTotals {
  return TODO()
}

export function resolveDuelAtBat(
  _pitch: number,
  _swing: number,
  _state: LiveGameState,
  _roster: Roster,
  _hitsBefore?: HitTotals,
): DuelResolution {
  return TODO()
}

export function createDuelAdapter(_roster: Roster, _context: GameContext): DuelAdapter {
  return TODO()
}
