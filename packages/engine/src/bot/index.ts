import { DUEL_MAX, DUEL_MIN } from '../atBat'

/** Count of valid committed numbers: the inclusive span [DUEL_MIN, DUEL_MAX]. */
const DUEL_RANGE = DUEL_MAX - DUEL_MIN + 1

/**
 * The bot's number-selection policy — the one source both the client bot
 * (`src/duel/botAgent.ts`, SAN-48) and the server bot (`convex/atBat.ts`
 * `commitBotSeat`, SAN-58) draw from.
 *
 * Uniform-random is the strategically-sound baseline, not a placeholder: in a
 * blind simultaneous duel the opponent's number is unknown, so the expected
 * outcome is identical across every pick — attributes size the outcome bands,
 * the committed number only sets the difference. Situational tendencies /
 * personality are a future enhancement, out of scope (SAN-48 TC).
 *
 * It takes a draw and nothing else, so no opponent's number — nor any other
 * part of the game — can reach the pick: the secret-state law holds for a bot
 * by the signature, not by the caller's restraint.
 *
 * `rng` must honor the standard [0, 1) contract; on that contract
 * `floor(rng() * DUEL_RANGE)` lands in [0, DUEL_RANGE), so every draw is a valid
 * duel number.
 */
export function pickBotNumber(rng: () => number = Math.random): number {
  return DUEL_MIN + Math.floor(rng() * DUEL_RANGE)
}
