export const DUEL_MIN = 1
export const DUEL_MAX = 1000

/** A committed duel number must be a whole number in [1, 1000]. */
export function isValidDuelNumber(raw: string): boolean {
  if (raw === '') return false
  const n = Number(raw)
  return Number.isInteger(n) && n >= DUEL_MIN && n <= DUEL_MAX
}
