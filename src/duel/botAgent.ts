import { pickBotNumber } from '@sandlot/engine/bot'
import type { SeatAgent } from './seatAgent'

/**
 * A non-human seat agent (SAN-48): supplies its seat's committed number from the
 * shared bot policy (`pickBotNumber`, `@sandlot/engine/bot` — which also records
 * why uniform-random is the right baseline). It implements the same `SeatAgent`
 * seam as the human seat, so the play loop drives it with no change at all
 * (`duelLoop.playHalfInning`) — which is what enables human-vs-bot and bot-vs-bot
 * on the mock half-inning. The server bot (SAN-58) draws from the same policy.
 *
 * The agent ignores the request entirely: it never reads — and, by the
 * `SeatCommitRequest` shape (a `DuelSituation` that structurally excludes both duel
 * numbers), structurally CANNOT read — the opposing seat's number. The secret-state
 * law therefore holds for a bot seat exactly as it does for a human seat (the pitch
 * is the vault's secret — AGENTS.md game integrity).
 *
 * `rng` is injectable for deterministic tests and defaults to `Math.random`.
 */
export function createBotAgent(rng: () => number = Math.random): SeatAgent {
  return {
    requestNumber: () => Promise.resolve(pickBotNumber(rng)),
  }
}
