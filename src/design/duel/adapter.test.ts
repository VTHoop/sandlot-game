import type { BaseState } from '@sandlot/engine/atBat'
import { GameStatus, Half, type LiveGameState } from '@sandlot/engine/game'
import { OUTCOME_BAND_KEYS, type OutcomeBandKey } from '@sandlot/engine/outcomes'
import { describe, expect, it } from 'vitest'
import { OUTCOME_LADDER } from '../../components/ui/OutcomeLadder'
import {
  accumulateHits,
  assembleRunnerSpeeds,
  createDuelAdapter,
  deriveScoreline,
  OUTCOME_KEY_BY_BAND,
  resolveDuelAtBat,
  toOutcomeKey,
} from './adapter'
import { ROSTER, type Roster, type RosterPlayer } from './roster'

// Probed against away-1 (R. VANCE) vs home-p (H. MARSH), bases empty, 0 outs:
// the folded difference lands these bands. Keep those two attribute blocks stable.
const HIT_AT_BAT = { pitch: 500, swing: 465 } as const // diff 35 → 1B
const WALK_AT_BAT = { pitch: 500, swing: 389 } as const // diff 111 → BB
const OUT_AT_BAT = { pitch: 500, swing: 113 } as const // diff 387 → K

const hit = (
  power: number,
  contact: number,
  speed: number,
  eye: number,
  run = speed,
): RosterPlayer => ({
  name: 'H',
  attributes: { power, contact, speed, eye },
  speed: run,
})
const arm = (run: number): RosterPlayer => ({
  name: 'P',
  attributes: { velocity: 3, movement: 3, awareness: 3, command: 3 },
  speed: run,
})

function liveState(overrides: Partial<LiveGameState> = {}): LiveGameState {
  return {
    status: GameStatus.Live,
    inning: 1,
    half: Half.Top,
    outs: 0,
    bases: { first: null, second: null, third: null },
    homeScore: 0,
    awayScore: 0,
    homeBattingIndex: 0,
    awayBattingIndex: 0,
    currentBatter: 'away-1',
    currentPitcher: 'home-p',
    lastResolvedSequence: -1,
    ...overrides,
  }
}

describe('assembleRunnerSpeeds', () => {
  const roster: Roster = new Map<string, RosterPlayer>([
    ['fast', hit(2, 2, 5, 2)],
    ['slow', hit(2, 2, 2, 2)],
    ['pitcher', arm(5)], // stored speed 5, but a pitcher-as-runner is forced to 1
  ])

  it('returns all-null on empty bases', () => {
    const empty: BaseState = { first: null, second: null, third: null }
    expect(assembleRunnerSpeeds(empty, roster)).toEqual({ first: null, second: null, third: null })
  })

  it('reads each on-base hitter’s stored base-running speed', () => {
    const bases: BaseState = { first: 'fast', second: 'slow', third: null }
    expect(assembleRunnerSpeeds(bases, roster)).toEqual({ first: 5, second: 2, third: null })
  })

  it('defaults a pitcher-as-runner to speed 1 regardless of stored speed', () => {
    const bases: BaseState = { first: 'slow', second: 'pitcher', third: null }
    expect(assembleRunnerSpeeds(bases, roster)).toEqual({ first: 2, second: 1, third: null })
  })
})

describe('OutcomeBandKey → OutcomeKey mapping', () => {
  it('covers the same 10 members as the engine band keys', () => {
    expect(Object.keys(OUTCOME_KEY_BY_BAND)).toHaveLength(10)
    expect(new Set(Object.keys(OUTCOME_KEY_BY_BAND))).toEqual(new Set(OUTCOME_BAND_KEYS))
    expect(new Set(Object.values(OUTCOME_KEY_BY_BAND))).toEqual(new Set(OUTCOME_LADDER))
  })

  it('round-trips every engine band to a UI key', () => {
    for (const band of OUTCOME_BAND_KEYS) {
      expect(toOutcomeKey(band)).toBe(band)
    }
  })

  it('throws loudly on an unmapped band', () => {
    expect(() => toOutcomeKey('XX' as OutcomeBandKey)).toThrow(/unmapped/)
  })
})

describe('deriveScoreline', () => {
  it('a single: where the batter stands', () => {
    expect(
      deriveScoreline({
        outcome: '1B',
        basesAfter: { first: 'b', second: null, third: null },
        runsScored: 0,
        batter: 'b',
      }),
    ).toBe('you stand on 1st')
  })

  it('a run-scoring double: runs and landing base', () => {
    expect(
      deriveScoreline({
        outcome: '2B',
        basesAfter: { first: null, second: 'b', third: null },
        runsScored: 1,
        batter: 'b',
      }),
    ).toBe('1 run scores · you stand on 2nd')
  })

  it('a run-scoring triple: the batter ends up on third', () => {
    expect(
      deriveScoreline({
        outcome: '3B',
        basesAfter: { first: null, second: null, third: 'b' },
        runsScored: 2,
        batter: 'b',
      }),
    ).toBe('2 runs score · you stand on 3rd')
  })

  it('a grand slam: pluralized runs, batter cleared the bases', () => {
    expect(
      deriveScoreline({
        outcome: 'HR',
        basesAfter: { first: null, second: null, third: null },
        runsScored: 4,
        batter: 'b',
      }),
    ).toBe('4 runs score · you go yard')
  })

  it('a bases-loaded walk: a forced run plus reaching first', () => {
    expect(
      deriveScoreline({
        outcome: 'BB',
        basesAfter: { first: 'b', second: 'x', third: 'y' },
        runsScored: 1,
        batter: 'b',
      }),
    ).toBe('1 run scores · you reach 1st')
  })

  it('a strikeout: the out phrasing, no runs', () => {
    expect(
      deriveScoreline({
        outcome: 'K',
        basesAfter: { first: null, second: null, third: null },
        runsScored: 0,
        batter: 'b',
      }),
    ).toBe('you strike out')
  })
})

describe('accumulateHits', () => {
  it('credits the batting team on a hit', () => {
    expect(accumulateHits({ you: 0, opp: 0 }, '1B')).toEqual({ you: 1, opp: 0 })
    expect(accumulateHits({ you: 2, opp: 1 }, 'HR')).toEqual({ you: 3, opp: 1 })
  })

  it('leaves the totals untouched on a non-hit', () => {
    expect(accumulateHits({ you: 1, opp: 0 }, 'K')).toEqual({ you: 1, opp: 0 })
    expect(accumulateHits({ you: 1, opp: 0 }, 'BB')).toEqual({ you: 1, opp: 0 })
  })
})

describe('resolveDuelAtBat', () => {
  it('maps a hit to an AppliedAtBat and a RevealScenario', () => {
    const { applied, reveal } = resolveDuelAtBat(
      HIT_AT_BAT.pitch,
      HIT_AT_BAT.swing,
      liveState(),
      ROSTER,
    )
    expect(applied).toEqual({
      sequence: 0,
      outsBefore: 0,
      outsAfter: 0,
      basesAfter: { first: 'away-1', second: null, third: null },
      runsScored: 0,
    })
    expect(reveal).toEqual({
      you: HIT_AT_BAT.swing,
      them: HIT_AT_BAT.pitch,
      opponent: 'H. MARSH',
      outcome: '1B',
      inning: 1,
      half: 'TOP',
      outs: 0,
      runsScored: 0,
      scoreBefore: { you: 0, opp: 0 },
      hitsBefore: { you: 0, opp: 0 },
      scoreline: 'you stand on 1st',
    })
  })

  it('maps an out: a third strike records an out and no base runner', () => {
    const { applied, reveal } = resolveDuelAtBat(
      OUT_AT_BAT.pitch,
      OUT_AT_BAT.swing,
      liveState(),
      ROSTER,
    )
    expect(reveal.outcome).toBe('K')
    expect(applied.outsAfter).toBe(1)
    expect(applied.basesAfter).toEqual({ first: null, second: null, third: null })
    expect(reveal.outs).toBe(1)
    expect(reveal.scoreline).toBe('you strike out')
  })

  it('maps a walk: the batter reaches first', () => {
    const { applied, reveal } = resolveDuelAtBat(
      WALK_AT_BAT.pitch,
      WALK_AT_BAT.swing,
      liveState(),
      ROSTER,
    )
    expect(reveal.outcome).toBe('BB')
    expect(applied.basesAfter).toEqual({ first: 'away-1', second: null, third: null })
    expect(reveal.scoreline).toBe('you reach 1st')
  })

  it('threads a running hit total into hitsBefore', () => {
    const { reveal } = resolveDuelAtBat(HIT_AT_BAT.pitch, HIT_AT_BAT.swing, liveState(), ROSTER, {
      you: 3,
      opp: 2,
    })
    expect(reveal.hitsBefore).toEqual({ you: 3, opp: 2 })
  })

  it('labels the half from the live state without flipping perspective', () => {
    const { reveal } = resolveDuelAtBat(
      HIT_AT_BAT.pitch,
      HIT_AT_BAT.swing,
      liveState({ half: Half.Bottom }),
      ROSTER,
    )
    expect(reveal.half).toBe('BOTTOM')
    // Perspective stays the batting team as "you": runs still credit your score side.
    expect(reveal.scoreBefore).toEqual({ you: 0, opp: 0 })
  })

  it('throws when no batter is seated', () => {
    expect(() =>
      resolveDuelAtBat(
        HIT_AT_BAT.pitch,
        HIT_AT_BAT.swing,
        liveState({ currentBatter: null }),
        ROSTER,
      ),
    ).toThrow(/No batter/)
  })

  it('throws when the seated batter carries no hitter block', () => {
    expect(() =>
      resolveDuelAtBat(
        HIT_AT_BAT.pitch,
        HIT_AT_BAT.swing,
        liveState({ currentBatter: 'home-p' }),
        ROSTER,
      ),
    ).toThrow(/hitter attribute block/)
  })

  it('throws when the seated pitcher carries no pitcher block', () => {
    expect(() =>
      resolveDuelAtBat(
        HIT_AT_BAT.pitch,
        HIT_AT_BAT.swing,
        liveState({ currentPitcher: 'away-1' }),
        ROSTER,
      ),
    ).toThrow(/pitcher attribute block/)
  })
})

describe('createDuelAdapter', () => {
  // Two identical leadoff-grade batters so the same probed numbers yield a hit twice.
  const leadoff = (): RosterPlayer => hit(3, 3, 3, 5)
  const roster: Roster = new Map<string, RosterPlayer>([
    ['h1', leadoff()],
    ['h2', leadoff()],
    ['o1', hit(2, 2, 2, 2)],
    ['P', arm(1)],
  ])
  const context = {
    away: { battingOrder: ['h1', 'h2'], pitcher: 'apx' },
    home: { battingOrder: ['o1'], pitcher: 'P' },
  }

  it('accumulates the running hit count across at-bats', () => {
    const adapter = createDuelAdapter(roster, context)

    const first = adapter.playAtBat(HIT_AT_BAT.pitch, HIT_AT_BAT.swing)
    expect(first.reveal.outcome).toBe('1B')
    expect(first.reveal.hitsBefore).toEqual({ you: 0, opp: 0 })
    expect(adapter.hits()).toEqual({ you: 1, opp: 0 })

    const second = adapter.playAtBat(HIT_AT_BAT.pitch, HIT_AT_BAT.swing)
    expect(second.reveal.outcome).toBe('1B')
    // The first hit is now on the books before the second at-bat reveals.
    expect(second.reveal.hitsBefore).toEqual({ you: 1, opp: 0 })
    expect(adapter.hits()).toEqual({ you: 2, opp: 0 })

    // State advanced through the engine: two at-bats folded in, runner aboard.
    expect(adapter.state().lastResolvedSequence).toBe(1)
    expect(adapter.state().bases.first).toBeTruthy()
  })
})
