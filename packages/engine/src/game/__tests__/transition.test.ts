import { describe, expect, it } from 'vitest'
import type { BaseState } from '../../atBat/advance'
import { type AppliedAtBat, type GameContext, GameStatus, Half, type LiveGameState } from '../state'
import { advance, startGame } from '../transition'

const EMPTY: BaseState = { first: false, second: false, third: false }

const order = (prefix: string, n = 9): string[] =>
  Array.from({ length: n }, (_, i) => `${prefix}${i + 1}`)

const CONTEXT: GameContext = {
  home: { battingOrder: order('H'), pitcher: 'HP' },
  away: { battingOrder: order('A'), pitcher: 'AP' },
}

/** A live state in the top of the 1st with away (A1..) at bat — overridable. */
function liveState(overrides: Partial<LiveGameState> = {}): LiveGameState {
  return {
    status: GameStatus.Live,
    inning: 1,
    half: Half.Top,
    outs: 0,
    bases: EMPTY,
    homeScore: 0,
    awayScore: 0,
    homeBattingIndex: 0,
    awayBattingIndex: 0,
    currentBatter: 'A1',
    currentPitcher: 'HP',
    lastResolvedSequence: -1,
    ...overrides,
  }
}

/** A strikeout-shaped at-bat: one out, no runs, bases unchanged. */
const k = (sequence: number, outsBefore: number, bases: BaseState = EMPTY): AppliedAtBat => ({
  sequence,
  outsBefore,
  outsAfter: outsBefore + 1,
  basesAfter: bases,
  runsScored: 0,
})

/** A run-scoring at-bat that records no out (e.g. a home run): bases cleared. */
const homer = (sequence: number, outsBefore: number, runsScored: number): AppliedAtBat => ({
  sequence,
  outsBefore,
  outsAfter: outsBefore,
  basesAfter: EMPTY,
  runsScored,
})

describe('startGame — scheduled → live initialization', () => {
  it('seeds inning 1 / top / 0 outs / empty bases / 0–0 and both pointers at 0', () => {
    expect(startGame(CONTEXT)).toEqual<LiveGameState>({
      status: GameStatus.Live,
      inning: 1,
      half: Half.Top,
      outs: 0,
      bases: EMPTY,
      homeScore: 0,
      awayScore: 0,
      homeBattingIndex: 0,
      awayBattingIndex: 0,
      currentBatter: 'A1', // away leads off the top of the 1st
      currentPitcher: 'HP', // home takes the mound
      lastResolvedSequence: -1,
    })
  })
})

describe('advance — per-at-bat folding', () => {
  it('accrues an out and advances the batting team to the next batter', () => {
    const next = advance(liveState(), k(0, 0), CONTEXT)
    expect(next).toMatchObject({
      outs: 1,
      awayBattingIndex: 1,
      currentBatter: 'A2',
      currentPitcher: 'HP',
      half: Half.Top,
      inning: 1,
      lastResolvedSequence: 0,
    })
    expect(next.homeScore).toBe(0)
    expect(next.awayScore).toBe(0)
  })

  it('credits runs to the away team in the top half', () => {
    const next = advance(liveState(), homer(0, 0, 1), CONTEXT)
    expect(next.awayScore).toBe(1)
    expect(next.homeScore).toBe(0)
    expect(next.outs).toBe(0)
    expect(next.awayBattingIndex).toBe(1)
    expect(next.currentBatter).toBe('A2')
  })

  it('credits runs to the home team in the bottom half', () => {
    const bottom = liveState({ half: Half.Bottom, currentBatter: 'H1', currentPitcher: 'AP' })
    const next = advance(bottom, homer(0, 0, 2), CONTEXT)
    expect(next.homeScore).toBe(2)
    expect(next.awayScore).toBe(0)
    expect(next.homeBattingIndex).toBe(1)
    expect(next.currentBatter).toBe('H2')
    expect(next.currentPitcher).toBe('AP')
  })

  it('wraps the batting-order pointer from the last slot back to the leadoff', () => {
    const next = advance(liveState({ awayBattingIndex: 8, currentBatter: 'A9' }), k(0, 0), CONTEXT)
    expect(next.awayBattingIndex).toBe(0)
    expect(next.currentBatter).toBe('A1')
  })

  it('wraps a short lineup correctly', () => {
    const twoMan: GameContext = {
      home: { battingOrder: order('H'), pitcher: 'HP' },
      away: { battingOrder: ['A1', 'A2'], pitcher: 'AP' },
    }
    const next = advance(liveState({ awayBattingIndex: 1, currentBatter: 'A2' }), k(0, 0), twoMan)
    expect(next.awayBattingIndex).toBe(0)
    expect(next.currentBatter).toBe('A1')
  })
})

describe('advance — half-inning and inning transitions on the third out', () => {
  it('flips top → bottom: resets outs/bases, swaps offense/defense, keeps the inning', () => {
    const next = advance(
      liveState({ outs: 2, awayBattingIndex: 5, currentBatter: 'A6' }),
      k(0, 2),
      CONTEXT,
    )
    expect(next).toMatchObject({
      half: Half.Bottom,
      inning: 1,
      outs: 0,
      bases: EMPTY,
      currentBatter: 'H1', // home resumes at its stored pointer (0)
      currentPitcher: 'AP', // away takes the mound
      homeBattingIndex: 0,
      awayBattingIndex: 6, // away pointer advanced and now persists
    })
  })

  it('flips bottom → top and increments the inning', () => {
    const next = advance(
      liveState({
        half: Half.Bottom,
        inning: 1,
        outs: 2,
        homeBattingIndex: 3,
        currentBatter: 'H4',
        currentPitcher: 'AP',
        lastResolvedSequence: 10,
      }),
      k(11, 2),
      CONTEXT,
    )
    expect(next).toMatchObject({
      half: Half.Top,
      inning: 2,
      outs: 0,
      bases: EMPTY,
      currentBatter: 'A1', // away resumes at its stored pointer (0)
      currentPitcher: 'HP',
      homeBattingIndex: 4, // home pointer advanced and persists
      awayBattingIndex: 0,
      status: GameStatus.Live,
    })
  })
})

describe('advance — end of game (6-inning regulation)', () => {
  it('ends the game after a completed bottom 6th when the score is not tied', () => {
    const next = advance(
      liveState({
        inning: 6,
        half: Half.Bottom,
        outs: 2,
        homeScore: 3,
        awayScore: 5,
        homeBattingIndex: 4,
        currentBatter: 'H5',
        currentPitcher: 'AP',
      }),
      k(0, 2),
      CONTEXT,
    )
    expect(next.status).toBe(GameStatus.Final)
    expect(next.currentBatter).toBeNull()
    expect(next.currentPitcher).toBeNull()
    expect(next.homeScore).toBe(3)
    expect(next.awayScore).toBe(5)
  })

  it('ends immediately when the home team already leads after the top of the 6th', () => {
    const next = advance(
      liveState({
        inning: 6,
        half: Half.Top,
        outs: 2,
        homeScore: 5,
        awayScore: 3,
        awayBattingIndex: 3,
        currentBatter: 'A4',
      }),
      k(0, 2),
      CONTEXT,
    )
    expect(next.status).toBe(GameStatus.Final)
    expect(next.currentBatter).toBeNull()
    expect(next.half).toBe(Half.Top) // the bottom 6th is never played
    expect(next.inning).toBe(6)
  })

  it('plays the bottom 6th when the score is tied after the top half', () => {
    const next = advance(
      liveState({ inning: 6, half: Half.Top, outs: 2, homeScore: 3, awayScore: 3 }),
      k(0, 2),
      CONTEXT,
    )
    expect(next.status).toBe(GameStatus.Live)
    expect(next.half).toBe(Half.Bottom)
    expect(next.inning).toBe(6)
    expect(next.currentBatter).toBe('H1')
    expect(next.currentPitcher).toBe('AP')
  })

  it('short-circuits to final the moment the home team takes the lead in the bottom 6th', () => {
    const next = advance(
      liveState({
        inning: 6,
        half: Half.Bottom,
        outs: 1,
        homeScore: 3,
        awayScore: 3,
        homeBattingIndex: 4,
        currentBatter: 'H5',
        currentPitcher: 'AP',
      }),
      homer(0, 1, 1), // walk-off run, only one out
      CONTEXT,
    )
    expect(next.status).toBe(GameStatus.Final)
    expect(next.homeScore).toBe(4)
    expect(next.currentBatter).toBeNull()
    expect(next.currentPitcher).toBeNull()
  })

  it('continues into extra innings when tied after a completed 6th', () => {
    const next = advance(
      liveState({
        inning: 6,
        half: Half.Bottom,
        outs: 2,
        homeScore: 3,
        awayScore: 3,
        homeBattingIndex: 2,
        currentBatter: 'H3',
        currentPitcher: 'AP',
      }),
      k(0, 2),
      CONTEXT,
    )
    expect(next.status).toBe(GameStatus.Live)
    expect(next.inning).toBe(7)
    expect(next.half).toBe(Half.Top)
    expect(next.currentBatter).toBe('A1')
    expect(next.currentPitcher).toBe('HP')
  })
})

describe('advance — guards', () => {
  it('rejects advancement of a final game', () => {
    const final = liveState({ status: GameStatus.Final, lastResolvedSequence: 5 })
    expect(() => advance(final, k(6, 0), CONTEXT)).toThrow()
  })

  it('is a no-op when re-applying an already-folded at-bat', () => {
    const state = liveState({ lastResolvedSequence: 3, awayBattingIndex: 4, currentBatter: 'A5' })
    expect(advance(state, k(3, 0), CONTEXT)).toEqual(state)
    expect(advance(state, k(2, 0), CONTEXT)).toEqual(state)
  })

  it('rejects a sequence gap', () => {
    const state = liveState({ lastResolvedSequence: 3 })
    expect(() => advance(state, k(5, 0), CONTEXT)).toThrow()
  })
})
