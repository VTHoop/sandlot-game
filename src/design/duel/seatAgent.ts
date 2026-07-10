import type { DuelSituation } from './scenario'

/**
 * The seat-agent seam (SAN-47): the boundary that names *who* supplies a seat's
 * committed number, without the play loop caring whether that's a human at the
 * commit screen or a future non-human agent. Only the human agent ships in this
 * ticket; a computed agent slots in by implementing the same `requestNumber` and
 * the loop is byte-for-byte identical (see `duelLoop.playHalfInning`).
 */

/** Which seat is on the clock. A TS enum per the project's finite-value-set
 * convention (cf. the engine's `Half`); distinct from the adapter's internal
 * `SeatedRole`, which labels a roster lookup rather than a duel participant. */
export enum DuelSeat {
  Pitcher = 'pitcher',
  Batter = 'batter',
}

/**
 * Everything a seat agent is shown when asked for its number: the seat and the
 * NON-SECRET situation, nothing else. `DuelSituation` structurally excludes both
 * duel numbers (see its definition), so the opposing seat's committed number
 * cannot reach an agent through this request — the secret-state law holds at the
 * seam, not merely in the UI (ADR-0014, AGENTS.md game integrity).
 */
export interface SeatCommitRequest {
  seat: DuelSeat
  situation: DuelSituation
}

/**
 * Who supplies a seat's committed number. The loop `await`s this and never
 * branches on the concrete agent: a human resolves it through the commit UI; a
 * computed agent would resolve it from the request alone. Async so both shapes
 * (an interaction that completes later, or an immediate computation) fit.
 */
export interface SeatAgent {
  requestNumber(request: SeatCommitRequest): Promise<number>
}
