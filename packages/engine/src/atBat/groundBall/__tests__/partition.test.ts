import { describe, expect, it } from 'vitest'
import type { Band } from '../../../rangeFinder/frontHalf'
import {
  type GroundBallSizing,
  type GroundBallSubBand,
  partitionGroundBall,
  selectGroundBallResult,
} from '../partition'
import { GroundBallResult } from '../result'

const { GO_RA, FC, FC_2ND, FC_3RD, FC_HOME, DP, TP } = GroundBallResult

// A representative GB band; the partition must work for any elastic {lo,hi}.
const BAND: Band = { lo: 300, hi: 424 } // width 125
const LOADED = [GO_RA, FC_2ND, FC_3RD, FC_HOME, DP, TP]
const FIRST = [GO_RA, FC, DP]

const sizing = (eligible: GroundBallResult[], band: Band, speedDiff: number): GroundBallSizing => ({
  eligible,
  band,
  speedDiff,
})

const widthOf = (bands: GroundBallSubBand[], r: GroundBallResult): number => {
  const sub = bands.find((b) => b.result === r)
  return sub ? sub.hi - sub.lo + 1 : 0
}

describe('partitionGroundBall — partition invariants', () => {
  it('covers [lo, hi] exactly: contiguous, gapless, non-overlapping, in order', () => {
    const bands = partitionGroundBall(sizing(LOADED, BAND, 0))
    expect(bands.map((b) => b.result)).toEqual(LOADED) // preserves low→high order
    expect(bands[0].lo).toBe(BAND.lo)
    expect(bands[bands.length - 1].hi).toBe(BAND.hi)
    // contiguous, no gap/overlap — each sub-band starts one past the previous hi
    bands.reduce((prev, sub) => {
      expect(sub.lo).toBe(prev.hi + 1)
      return sub
    })
    const total = bands.reduce((sum, b) => sum + (b.hi - b.lo + 1), 0)
    expect(total).toBe(BAND.hi - BAND.lo + 1)
  })

  it('every eligible sub-result is reachable (width >= 1)', () => {
    for (const sub of partitionGroundBall(sizing(LOADED, BAND, 0))) {
      expect(sub.hi).toBeGreaterThanOrEqual(sub.lo)
    }
  })

  it('TP is the top slice, at least one number wide, ending at band.hi', () => {
    const bands = partitionGroundBall(sizing(LOADED, BAND, 0))
    const tp = bands[bands.length - 1]
    expect(tp.result).toBe(TP)
    expect(tp.hi).toBe(BAND.hi)
    expect(tp.hi - tp.lo + 1).toBeGreaterThanOrEqual(1)
  })

  it('a sole eligible result takes the whole band', () => {
    const bands = partitionGroundBall(sizing([GO_RA], BAND, 0))
    expect(bands).toEqual([{ result: GO_RA, lo: BAND.lo, hi: BAND.hi }])
  })

  it('keeps TP its top-of-band number even when the band is narrower than the eligible set', () => {
    // Squeeze: 6 eligible results into a 4-wide band. The partition must stay exact
    // and TP must still own band.hi — a lower-priority slice is dropped, not TP.
    const tiny: Band = { lo: 10, hi: 13 } // width 4 < 6 eligible
    const bands = partitionGroundBall(sizing(LOADED, tiny, 0))
    expect(bands[0].lo).toBe(tiny.lo)
    expect(bands[bands.length - 1].result).toBe(TP)
    expect(bands[bands.length - 1].hi).toBe(tiny.hi)
    bands.reduce((prev, sub) => {
      expect(sub.lo).toBe(prev.hi + 1)
      return sub
    })
    const total = bands.reduce((sum, b) => sum + (b.hi - b.lo + 1), 0)
    expect(total).toBe(tiny.hi - tiny.lo + 1)
    expect(selectGroundBallResult(sizing(LOADED, tiny, 0), tiny.hi)).toBe(TP)
  })
})

describe('partitionGroundBall — directional speed rule (FC grows, DP shrinks)', () => {
  it('DP width is non-increasing and FC-family width non-decreasing as the speed edge rises', () => {
    const widths = [-3, -2, -1, 0, 1, 2, 3].map((speedDiff) => {
      const bands = partitionGroundBall(sizing(LOADED, BAND, speedDiff))
      return {
        dp: widthOf(bands, DP),
        fc: widthOf(bands, FC_2ND) + widthOf(bands, FC_3RD) + widthOf(bands, FC_HOME),
      }
    })
    // DP non-increasing and FC-family non-decreasing as the speed edge rises
    widths.reduce((prev, cur) => {
      expect(cur.dp).toBeLessThanOrEqual(prev.dp)
      expect(cur.fc).toBeGreaterThanOrEqual(prev.fc)
      return cur
    })
    expect(widths[widths.length - 1].dp).toBeLessThan(widths[0].dp) // strictly shrinks overall
  })

  it('GO_RA stays a small near-constant slice across the speed axis', () => {
    const goRaWidths = [-3, 0, 3].map((d) =>
      widthOf(partitionGroundBall(sizing(FIRST, BAND, d)), GO_RA),
    )
    const spread = Math.max(...goRaWidths) - Math.min(...goRaWidths)
    expect(spread).toBeLessThanOrEqual(1) // constant up to integer rounding
  })
})

describe('selectGroundBallResult', () => {
  it('maps the bottom of the band to the first result and the top to TP', () => {
    expect(selectGroundBallResult(sizing(LOADED, BAND, 0), BAND.lo)).toBe(GO_RA)
    expect(selectGroundBallResult(sizing(LOADED, BAND, 0), BAND.hi)).toBe(TP)
  })

  it('every number in the band resolves to exactly one eligible result', () => {
    for (let d = BAND.lo; d <= BAND.hi; d++) {
      expect(LOADED).toContain(selectGroundBallResult(sizing(LOADED, BAND, 0), d))
    }
  })

  it('throws for a difference outside the band', () => {
    expect(() => selectGroundBallResult(sizing(LOADED, BAND, 0), BAND.lo - 1)).toThrow(RangeError)
  })
})
