import {
  type AppliedAtBat,
  DEFAULT_CONFIG,
  type GameConfig,
  type GameContext,
  type LiveGameState,
} from './state'

// SAN-21 RED stub — implemented in the GREEN commit.
export function startGame(
  _context: GameContext,
  _config: GameConfig = DEFAULT_CONFIG,
): LiveGameState {
  throw new Error('not implemented')
}

// SAN-21 RED stub — implemented in the GREEN commit.
export function advance(
  _state: LiveGameState,
  _atBat: AppliedAtBat,
  _context: GameContext,
  _config: GameConfig = DEFAULT_CONFIG,
): LiveGameState {
  throw new Error('not implemented')
}
