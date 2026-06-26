import { describe, expect, it } from 'vitest'
import { toAttributeDiff } from '../../../tables/accessor'
import type { BaseState } from '../../advance'
import type { BuntAccessors } from '../partition'
import { resolveBunt } from '../resolve'
import { BuntResult } from '../result'

// ─── Frozen test rig ──────────────────────────────────────────────────────────
// Fixed widths make the [4, 496] middle band exact: bunt-for-hit [4, 13] (width
// 10), sacrifice [14, 113] (width 100), dud [114, 496]. The fixed tails are
// butcher boy [0, 3] and the triple/double-play top tail [497, 499].

const WIDTHS: BuntAccessors = { buntHitWidth: () => 10, sacWidth: () => 100 }
const DIFF0 = toAttributeDiff(0)
const BATTER = 'batter'

const FIRST: BaseState = { first: 'r1', second: null, third: null }
const SECOND: BaseState = { first: null, second: 'r2', third: null }
const THIRD: BaseState = { first: null, second: null, third: 'r3' }
const FIRST_SECOND: BaseState = { first: 'r1', second: 'r2', third: null }
const LOADED: BaseState = { first: 'r1', second: 'r2', third: 'r3' }
const EMPTY: BaseState = { first: null, second: null, third: null }

const bunt = (difference: number, basesBefore: BaseState, outsBefore = 0) =>
  resolveBunt(
    {
      difference,
      basesBefore,
      outsBefore,
      batter: BATTER,
      contactMovDiff: DIFF0,
      speedAwaDiff: DIFF0,
    },
    WIDTHS,
  )

// ─── Butcher boy (0–3 tail) ───────────────────────────────────────────────────

describe('resolveBunt — butcher boy (0–3 difference)', () => {
  it('awards a single and advances every runner an extra base', () => {
    expect(bunt(0, LOADED)).toEqual({
      result: BuntResult.BUTCHER_BOY,
      runsScored: 2, // r3 and r2 score
      rbi: 2,
      outsAfter: 0,
      basesAfter: { first: BATTER, second: null, third: 'r1' }, // r1 takes the extra base to third
    })
  })

  it('covers the whole 0–3 tail', () => {
    expect(bunt(3, FIRST).result).toBe(BuntResult.BUTCHER_BOY)
  })
})

// ─── Bunt for a hit ───────────────────────────────────────────────────────────

describe('resolveBunt — bunt for a hit', () => {
  it('puts the batter on first and advances runners one base (no out)', () => {
    expect(bunt(4, FIRST)).toEqual({
      result: BuntResult.BUNT_HIT,
      runsScored: 0,
      rbi: 0,
      outsAfter: 0,
      basesAfter: { first: BATTER, second: 'r1', third: null },
    })
  })

  it('covers the bunt-for-hit range up to its edge', () => {
    expect(bunt(13, FIRST).result).toBe(BuntResult.BUNT_HIT)
  })
})

// ─── Sacrifice (by lead runner) ───────────────────────────────────────────────

describe('resolveBunt — successful sacrifice advances the lead runner, batter out', () => {
  it('Sac 2nd: lead runner on first → second', () => {
    expect(bunt(14, FIRST)).toEqual({
      result: BuntResult.SAC_2ND,
      runsScored: 0,
      rbi: 0,
      outsAfter: 1,
      basesAfter: { first: null, second: 'r1', third: null },
    })
  })

  it('Sac 3rd: lead runner on second → third', () => {
    expect(bunt(50, SECOND).result).toBe(BuntResult.SAC_3RD)
    expect(bunt(50, SECOND).basesAfter).toEqual({ first: null, second: null, third: 'r2' })
  })

  it('Sac Home: lead runner on third scores (RBI)', () => {
    expect(bunt(113, THIRD)).toEqual({
      result: BuntResult.SAC_HOME,
      runsScored: 1,
      rbi: 1,
      outsAfter: 1,
      basesAfter: { first: null, second: null, third: null },
    })
  })

  it('suppresses the sac-home run when it is the third out', () => {
    const r = bunt(113, THIRD, 2)
    expect(r.result).toBe(BuntResult.SAC_HOME)
    expect(r.outsAfter).toBe(3)
    expect(r.runsScored).toBe(0) // the run is wiped by the inning-ending out
  })
})

// ─── Dud (middle remainder) ───────────────────────────────────────────────────

describe('resolveBunt — dud (failed bunt)', () => {
  it('records the batter out with no advancement past the sac range', () => {
    expect(bunt(114, FIRST)).toEqual({
      result: BuntResult.DUD,
      runsScored: 0,
      rbi: 0,
      outsAfter: 1,
      basesAfter: FIRST,
    })
  })

  it('falls to a dud when no runner is aboard to sacrifice', () => {
    expect(bunt(50, EMPTY).result).toBe(BuntResult.DUD)
  })
})

// ─── Top tail (498–500): triple / double play / dud ───────────────────────────

describe('resolveBunt — top tail (498–500 difference)', () => {
  it('triple play with a force at every base in play and 0 outs', () => {
    expect(bunt(497, FIRST_SECOND)).toEqual({
      result: BuntResult.TP,
      runsScored: 0,
      rbi: 0,
      outsAfter: 3,
      basesAfter: EMPTY,
    })
  })

  it('defaults to a double play when a triple play is not possible', () => {
    const r = bunt(499, FIRST)
    expect(r.result).toBe(BuntResult.DP)
    expect(r.outsAfter).toBe(2)
    expect(r.basesAfter).toEqual(EMPTY)
  })

  it('falls to a dud in the top tail when no force is available', () => {
    expect(bunt(498, EMPTY).result).toBe(BuntResult.DUD)
    expect(bunt(498, EMPTY).outsAfter).toBe(1)
  })

  it('a triple play is not possible with an out already, so it is a double play', () => {
    expect(bunt(497, FIRST_SECOND, 1).result).toBe(BuntResult.DP)
  })
})
