/** Inclusive lower bound of a committed duel number. */
export const DUEL_MIN = 1
/** Inclusive upper bound — the ring of 999 (odd, so no antipode). See ADR-0016. */
export const DUEL_MAX = 999

/** Circular distance between two duel numbers, folded onto 0–499. */
export function foldDifference(_a: number, _b: number): number {
  throw new Error('not implemented')
}
