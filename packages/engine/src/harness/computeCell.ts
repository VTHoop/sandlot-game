import { assembleBackHalf } from '../rangeFinder/backHalf'
import { assembleFrontHalf } from '../rangeFinder/frontHalf'
import { OUTS_PER_GAME } from './linearWeights'
import type { CellDiffs, CellResult, OutcomeRates, RunValues, SlashLine } from './types'

// The 0–499 difference line has 500 positions.
// Rate identity: rate = band_width / RANGE. The circular fold of two uniform
// 1–999 draws (ring of 999, ADR-0016) is uniform across the interior 1–499;
// only the exact-match value 0 is half-weight, so this analytic identity is an
// idealization that treats all 500 positions as equally likely.
const RANGE = 500

function bandWidth(lo: number, hi: number): number {
  return hi - lo + 1
}

function computeRates(diffs: CellDiffs): OutcomeRates {
  const front = assembleFrontHalf(diffs)
  const back = assembleBackHalf(
    { powerVel: diffs.powerVel, contactMov: diffs.contactMov },
    front.BB.hi + 1,
  )
  return {
    hr: bandWidth(front.HR.lo, front.HR.hi) / RANGE,
    triple: bandWidth(front['3B'].lo, front['3B'].hi) / RANGE,
    double: bandWidth(front['2B'].lo, front['2B'].hi) / RANGE,
    single: bandWidth(front['1B'].lo, front['1B'].hi) / RANGE,
    if1b: bandWidth(front.IF1B.lo, front.IF1B.hi) / RANGE,
    bb: bandWidth(front.BB.lo, front.BB.hi) / RANGE,
    fo: bandWidth(back.FO.lo, back.FO.hi) / RANGE,
    po: bandWidth(back.PO.lo, back.PO.hi) / RANGE,
    gb: bandWidth(back.GB.lo, back.GB.hi) / RANGE,
    k: bandWidth(back.K.lo, back.K.hi) / RANGE,
  }
}

function ratesToSlashLine(r: OutcomeRates): SlashLine {
  const h = r.hr + r.triple + r.double + r.single + r.if1b
  // AB = PA − BB; since each roll is one PA, AB rate = 1 − bb_rate
  const abRate = 1 - r.bb
  const totalBases = 4 * r.hr + 3 * r.triple + 2 * r.double + (r.single + r.if1b)
  return {
    avg: h / abRate,
    obp: h + r.bb,
    slg: totalBases / abRate,
    hrPct: r.hr,
    kPct: r.k,
    bbPct: r.bb,
  }
}

function computeRunsPerGame(rates: OutcomeRates, weights: RunValues): number {
  const runsPerPA =
    rates.hr * weights.hr +
    rates.triple * weights.triple +
    rates.double * weights.double +
    rates.single * weights.single +
    rates.if1b * weights.if1b +
    rates.bb * weights.bb +
    rates.fo * weights.fo +
    rates.po * weights.po +
    rates.gb * weights.gb +
    rates.k * weights.k

  const outRate = rates.fo + rates.po + rates.gb + rates.k
  // PA/game = OUTS_PER_GAME / outRate; runs/game = runsPerPA × PA/game
  return (runsPerPA / outRate) * OUTS_PER_GAME
}

/** Assemble the full band stack for one matchup and return exact rates, slash line, and runs/game. */
export function computeCell(diffs: CellDiffs, weights: RunValues): CellResult {
  const rates = computeRates(diffs)
  return {
    diffs,
    rates,
    slashLine: ratesToSlashLine(rates),
    runsPerGame: computeRunsPerGame(rates, weights),
  }
}
