import { DUEL_MAX, DUEL_MIN, isDuelNumber } from '@sandlot/engine/atBat'

export { DUEL_MAX, DUEL_MIN }

/** A committed duel number must be a whole number in [1, 999] (ring of 999, ADR-0016). */
export function isValidDuelNumber(raw: string): boolean {
  if (raw === '') return false
  return isDuelNumber(Number(raw))
}
