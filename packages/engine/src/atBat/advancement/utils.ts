/** Clamp `n` into the inclusive `[lo, hi]` range. Shared by the SAN-17 advancement
 * width calculations (extra-base, deep-fly). */
export const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, n))
