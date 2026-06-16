/** Inclusive lower bound of a committed duel number. */
export const DUEL_MIN = 1
/** Inclusive upper bound — the ring of 999 (odd, so no antipode). See ADR-0016. */
export const DUEL_MAX = 999

/**
 * Circular distance between two duel numbers, folded onto 0–499.
 *
 * The numbers live on a ring of 999 (DUEL_MAX). Because 999 is odd there is no
 * antipode, so `min(d, 999 − d)` covers exactly 0–499 — the engine's band range
 * — with no clamp and no value ever landing outside the assembled partition.
 * Smaller distance (closer guess) = better outcome for the batter. See ADR-0016.
 */
export function foldDifference(a: number, b: number): number {
  const d = Math.abs(a - b)
  return Math.min(d, DUEL_MAX - d)
}
