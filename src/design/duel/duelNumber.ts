export const DUEL_MIN = 1
export const DUEL_MAX = 999

/** A committed duel number must be a whole number in [1, 999] (ring of 999, ADR-0016). */
export function isValidDuelNumber(raw: string): boolean {
  if (raw === '') return false
  const n = Number(raw)
  return Number.isInteger(n) && n >= DUEL_MIN && n <= DUEL_MAX
}
