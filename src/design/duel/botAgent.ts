import { DUEL_MAX, DUEL_MIN } from '@sandlot/engine/atBat'
import type { SeatAgent } from './seatAgent'

/** Count of valid committed numbers: the inclusive span [DUEL_MIN, DUEL_MAX]. */
const DUEL_RANGE = DUEL_MAX - DUEL_MIN + 1

/**
 * A non-human seat agent (SAN-48): supplies its seat's committed number by drawing
 * uniformly at random over the valid duel range [DUEL_MIN, DUEL_MAX]. It implements
 * the same `SeatAgent` seam as the human seat, so the play loop drives it with no
 * change at all (`duelLoop.playHalfInning`) — which is what enables human-vs-bot and
 * bot-vs-bot on the mock half-inning.
 *
 * Uniform-random is the strategically-sound baseline, not a placeholder: in a blind
 * simultaneous duel the opponent's number is unknown, so the expected outcome is
 * identical across every pick — attributes size the outcome bands, the committed
 * number only sets the difference. Situational tendencies / personality are a future
 * enhancement, out of scope here (SAN-48 TC); this is the seed of a future
 * bot-vs-bot balance simulator (ADR-0010/0015).
 *
 * The agent ignores the request entirely: it never reads — and, by the
 * `SeatCommitRequest` shape (a `DuelSituation` that structurally excludes both duel
 * numbers), structurally CANNOT read — the opposing seat's number. The secret-state
 * law therefore holds for a bot seat exactly as it does for a human seat (the pitch
 * is the vault's secret — AGENTS.md game integrity).
 *
 * `rng` is injectable for deterministic tests and defaults to `Math.random`. It must
 * honor the standard [0, 1) contract; on that contract `floor(rng() * DUEL_RANGE)`
 * lands in [0, DUEL_RANGE), so every draw is a valid duel number.
 */
export function createBotAgent(rng: () => number = Math.random): SeatAgent {
  return {
    requestNumber: () => Promise.resolve(DUEL_MIN + Math.floor(rng() * DUEL_RANGE)),
  }
}
