import { describe, expect, it } from 'vitest'
import type { Band } from '../../../rangeFinder/frontHalf'
import { type GroundBallSubBand, partitionGroundBall, selectGroundBallResult } from '../partition'
import { GroundBallResult } from '../result'

const { GO_RA, FC, FC_2ND, FC_3RD, FC_HOME, DP, TP } = GroundBallResult

// A representative GB band; the partition must work for any elastic {lo,hi}.
const BAND: Band = { lo: 300, hi: 424 } // width 125
const LOADED = [GO_RA, FC_2ND, FC_3RD, FC_HOME, DP, TP]
const FIRST = [GO_RA, FC, DP]

const widthOf = (bands: GroundBallSubBand[], r: GroundBallResult): number => {
  const sub = bands.find((b) => b.result === r)
  return sub ? sub.hi - sub.lo + 1 : 0
}

describe('partitionGroundBall — partition invariants', () => {
  it('covers [lo, hi] exactly: contiguous, gapless, non-overlapping, in order', () => {
    const bands = partitionGroundBall(LOADED, BAND, 0)
    expect(bands.map((b) => b.result)).toEqual(LOADED) // preserves low→high order
    expect(bands[0].lo).toBe(BAND.lo)
    expect(bands[bands.length - 1].hi).toBe(BAND.hi)
    for (let i = 1; i < bands.length; i++) {
      expect(bands[i].lo).toBe(bands[i - 1].hi + 1) // contiguous, no gap/overlap
    }
    const total = bands.reduce((sum, b) => sum + (b.hi - b.lo + 1), 0)
    expect(total).toBe(BAND.hi - BAND.lo + 1)
  })

  it('every eligible sub-result is reachable (width >= 1)', () => {
    for (const sub of partitionGroundBall(LOADED, BAND, 0)) {
      expect(sub.hi).toBeGreaterThanOrEqual(sub.lo)
    }
  })

  it('TP is the top slice, at least one number wide, ending at band.hi', () => {
    const bands = partitionGroundBall(LOADED, BAND, 0)
    const tp = bands[bands.length - 1]
    expect(tp.result).toBe(TP)
    expect(tp.hi).toBe(BAND.hi)
    expect(tp.hi - tp.lo + 1).toBeGreaterThanOrEqual(1)
  })

  it('a sole eligible result takes the whole band', () => {
    const bands = partitionGroundBall([GO_RA], BAND, 0)
    expect(bands).toEqual([{ result: GO_RA, lo: BAND.lo, hi: BAND.hi }])
  })
})

describe('partitionGroundBall — directional speed rule (FC grows, DP shrinks)', () => {
  it('DP width is non-increasing and FC-family width non-decreasing as the speed edge rises', () => {
    const dpWidths: number[] = []
    const fcWidths: number[] = []
    for (const speedDiff of [-3, -2, -1, 0, 1, 2, 3]) {
      const bands = partitionGroundBall(LOADED, BAND, speedDiff)
      dpWidths.push(widthOf(bands, DP))
      fcWidths.push(widthOf(bands, FC_2ND) + widthOf(bands, FC_3RD) + widthOf(bands, FC_HOME))
    }
    for (let i = 1; i < dpWidths.length; i++) {
      expect(dpWidths[i]).toBeLessThanOrEqual(dpWidths[i - 1])
      expect(fcWidths[i]).toBeGreaterThanOrEqual(fcWidths[i - 1])
    }
    expect(dpWidths[dpWidths.length - 1]).toBeLessThan(dpWidths[0]) // strictly shrinks overall
  })

  it('GO_RA stays a small near-constant slice across the speed axis', () => {
    const goRaWidths = [-3, 0, 3].map((d) => widthOf(partitionGroundBall(FIRST, BAND, d), GO_RA))
    const spread = Math.max(...goRaWidths) - Math.min(...goRaWidths)
    expect(spread).toBeLessThanOrEqual(1) // constant up to integer rounding
  })
})

describe('selectGroundBallResult', () => {
  it('maps the bottom of the band to the first result and the top to TP', () => {
    expect(selectGroundBallResult(BAND.lo, LOADED, BAND, 0)).toBe(GO_RA)
    expect(selectGroundBallResult(BAND.hi, LOADED, BAND, 0)).toBe(TP)
  })

  it('every number in the band resolves to exactly one eligible result', () => {
    for (let d = BAND.lo; d <= BAND.hi; d++) {
      expect(LOADED).toContain(selectGroundBallResult(d, LOADED, BAND, 0))
    }
  })

  it('throws for a difference outside the band', () => {
    expect(() => selectGroundBallResult(BAND.lo - 1, LOADED, BAND, 0)).toThrow(RangeError)
  })
})
