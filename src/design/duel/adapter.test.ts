import type { BaseState, HitterAttributes } from '@sandlot/engine/atBat'
import { GameStatus, Half, type LiveGameState } from '@sandlot/engine/game'
import { OUTCOME_BAND_KEYS, type OutcomeBandKey } from '@sandlot/engine/outcomes'
import { describe, expect, it } from 'vitest'
import { OUTCOME_LADDER, type OutcomeKey } from '../../components/ui/OutcomeLadder'
import {
  accumulateHits,
  assembleRunnerSpeeds,
  createDuelAdapter,
  deriveMatchup,
  deriveScoreline,
  deriveSituation,
  OUTCOME_KEY_BY_BAND,
  resolveDuelAtBat,
  toOutcomeKey,
} from './adapter'
import { GAME_CONTEXT, ROSTER, type Roster, type RosterPlayer } from './roster'

// Probed against away-1 (R. VANCE) vs home-p (H. MARSH), bases empty, 0 outs:
// the folded difference lands these bands. Keep those two attribute blocks stable.
const HIT_AT_BAT = { pitch: 500, swing: 465 } as const // diff 35 → 1B
const WALK_AT_BAT = { pitch: 500, swing: 389 } as const // diff 111 → BB
const OUT_AT_BAT = { pitch: 500, swing: 113 } as const // diff 387 → K

const hit = (attributes: HitterAttributes, run = attributes.speed): RosterPlayer => ({
  name: 'H',
  attributes,
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
  const roster: Roster = new Map([
    ['fast', hit({ power: 2, contact: 2, speed: 5, eye: 2 })],
    ['slow', hit({ power: 2, contact: 2, speed: 2, eye: 2 })],
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

  it('defaults an occupied base whose id is absent from the roster to speed 1', () => {
    const bases: BaseState = { first: 'ghost', second: null, third: null }
    expect(assembleRunnerSpeeds(bases, roster)).toEqual({ first: 1, second: null, third: null })
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
  // One uniform shape (outcome + post-state bases + runs → line), so the cases are
  // a table rather than near-identical test functions. The batter id is always
  // 'b'; `basesAfter` is what reaches base after the play.
  const cases: Array<{
    name: string
    outcome: OutcomeKey
    basesAfter: BaseState
    runsScored: number
    expected: string
  }> = [
    {
      name: 'a single: where the batter stands',
      outcome: '1B',
      basesAfter: { first: 'b', second: null, third: null },
      runsScored: 0,
      expected: 'you stand on 1st',
    },
    {
      name: 'a run-scoring double: runs and landing base',
      outcome: '2B',
      basesAfter: { first: null, second: 'b', third: null },
      runsScored: 1,
      expected: '1 run scores · you stand on 2nd',
    },
    {
      name: 'a run-scoring triple: the batter ends up on third',
      outcome: '3B',
      basesAfter: { first: null, second: null, third: 'b' },
      runsScored: 2,
      expected: '2 runs score · you stand on 3rd',
    },
    {
      name: 'a grand slam: pluralized runs, batter cleared the bases',
      outcome: 'HR',
      basesAfter: { first: null, second: null, third: null },
      runsScored: 4,
      expected: '4 runs score · you go yard',
    },
    {
      name: 'a bases-loaded walk: a forced run plus reaching first',
      outcome: 'BB',
      basesAfter: { first: 'b', second: 'x', third: 'y' },
      runsScored: 1,
      expected: '1 run scores · you reach 1st',
    },
    {
      name: 'a strikeout: the out phrasing, no runs',
      outcome: 'K',
      basesAfter: { first: null, second: null, third: null },
      runsScored: 0,
      expected: 'you strike out',
    },
    {
      name: 'a fly out: its out phrasing',
      outcome: 'FO',
      basesAfter: { first: null, second: null, third: null },
      runsScored: 0,
      expected: 'you fly out',
    },
    {
      name: 'a pop out: its out phrasing',
      outcome: 'PO',
      basesAfter: { first: null, second: null, third: null },
      runsScored: 0,
      expected: 'you pop out',
    },
    {
      name: 'a groundout: its out phrasing',
      outcome: 'GB',
      basesAfter: { first: null, second: null, third: null },
      runsScored: 0,
      expected: 'you ground out',
    },
  ]

  it.each(cases)('$name', ({ outcome, basesAfter, runsScored, expected }) => {
    expect(deriveScoreline({ outcome, basesAfter, runsScored, batter: 'b' })).toBe(expected)
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

  it('fixes "you" to the batting team — the home side bats the bottom half', () => {
    // Bottom half: the home team is at bat against the away pitcher, so "you" is
    // the home score (2), not the away score (5). Perspective follows the batting
    // team, not a hardcoded side.
    const { reveal } = resolveDuelAtBat(
      HIT_AT_BAT.pitch,
      HIT_AT_BAT.swing,
      liveState({
        half: Half.Bottom,
        currentBatter: 'home-1',
        currentPitcher: 'away-p',
        homeScore: 2,
        awayScore: 5,
      }),
      ROSTER,
    )
    expect(reveal.half).toBe('BOTTOM')
    expect(reveal.scoreBefore).toEqual({ you: 2, opp: 5 })
    expect(reveal.opponent).toBe('G. PIKE')
  })

  // Each rejection is the same shape (a live state that can't seat the matchup →
  // a thrown error), so the cases are a table rather than near-identical functions.
  it.each([
    {
      name: 'throws when no batter is seated',
      state: liveState({ currentBatter: null }),
      error: /No batter/,
    },
    {
      name: 'throws when the seated batter carries no hitter block',
      state: liveState({ currentBatter: 'home-p' }),
      error: /hitter attribute block/,
    },
    {
      name: 'throws when the seated pitcher carries no pitcher block',
      state: liveState({ currentPitcher: 'away-1' }),
      error: /pitcher attribute block/,
    },
  ])('$name', ({ state, error }) => {
    expect(() => resolveDuelAtBat(HIT_AT_BAT.pitch, HIT_AT_BAT.swing, state, ROSTER)).toThrow(error)
  })
})

describe('createDuelAdapter', () => {
  // Two identical leadoff-grade batters so the same probed numbers yield a hit twice.
  const leadoff = (): RosterPlayer => hit({ power: 3, contact: 3, speed: 3, eye: 5 })
  const roster: Roster = new Map([
    ['h1', leadoff()],
    ['h2', leadoff()],
    ['o1', hit({ power: 2, contact: 2, speed: 2, eye: 2 })],
    ['P', arm(1)],
    ['apx', arm(2)], // away pitcher — faced once the home side bats the bottom
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

  it('swaps the hit totals to the new batting side when the third out flips the half', () => {
    const adapter = createDuelAdapter(roster, context)

    // Top half: the away side singles (its running hits → 1), then strikes out
    // three times to end the half.
    adapter.playAtBat(HIT_AT_BAT.pitch, HIT_AT_BAT.swing)
    expect(adapter.hits()).toEqual({ you: 1, opp: 0 })
    adapter.playAtBat(OUT_AT_BAT.pitch, OUT_AT_BAT.swing)
    adapter.playAtBat(OUT_AT_BAT.pitch, OUT_AT_BAT.swing)
    adapter.playAtBat(OUT_AT_BAT.pitch, OUT_AT_BAT.swing)

    // The half flipped: the home side now bats, so its own total is "you" (0) and
    // the away team's hit carries as "opp" — not stale away "you".
    expect(adapter.state().half).toBe(Half.Bottom)
    expect(adapter.hits()).toEqual({ you: 0, opp: 1 })

    const bottom = adapter.playAtBat(HIT_AT_BAT.pitch, HIT_AT_BAT.swing)
    expect(bottom.reveal.hitsBefore).toEqual({ you: 0, opp: 1 })
  })

  it('hands back defensive copies that cannot corrupt internal state', () => {
    const adapter = createDuelAdapter(roster, context)

    const snapState = adapter.state()
    snapState.outs = 2
    snapState.bases.first = 'tamper'
    const snapHits = adapter.hits()
    snapHits.you = 99

    // The adapter's own state is untouched by the mutated snapshots.
    expect(adapter.state().outs).toBe(0)
    expect(adapter.state().bases.first).toBeNull()
    expect(adapter.hits()).toEqual({ you: 0, opp: 0 })
  })
})

describe('deriveSituation', () => {
  it('projects the non-secret situation for the seat on the clock', () => {
    const situation = deriveSituation(
      liveState({ awayScore: 2, homeScore: 1, outs: 1 }),
      { you: 3, opp: 4 },
      ROSTER,
    )
    expect(situation).toEqual({
      opponent: 'H. MARSH',
      inning: 1,
      half: 'TOP',
      outs: 1,
      scoreBefore: { you: 2, opp: 1 },
      hitsBefore: { you: 3, opp: 4 },
    })
  })

  it('is structurally free of either duel number (secret-state law)', () => {
    const situation = deriveSituation(liveState(), { you: 0, opp: 0 }, ROSTER)
    expect(situation).not.toHaveProperty('you')
    expect(situation).not.toHaveProperty('them')
  })

  it('credits the home score as “you” once the home side bats the bottom half', () => {
    const situation = deriveSituation(
      liveState({ half: Half.Bottom, awayScore: 5, homeScore: 3, currentPitcher: 'away-p' }),
      { you: 0, opp: 0 },
      ROSTER,
    )
    expect(situation.scoreBefore).toEqual({ you: 3, opp: 5 })
  })
})

describe('deriveMatchup', () => {
  it('mirrors the live pitcher-vs-batter matchup for both seats, mapping attrs to pips', () => {
    const matchup = deriveMatchup(liveState(), ROSTER, GAME_CONTEXT)
    // Both seats depict the SAME real matchup; DuelCommit orients it per seat.
    expect(matchup.you).toBe(matchup.opponent)
    expect(matchup.you.pitcher).toEqual({ name: 'H. MARSH', attrs: { VEL: 3, MOV: 3, CMD: 1 } })
    expect(matchup.you.batter).toEqual({
      name: 'R. VANCE',
      attrs: { PWR: 3, CON: 3, SPD: 3, EYE: 5 },
    })
    expect(matchup.you.dueUp).toEqual(['T. JULIEN', 'S. ORTIZ'])
  })

  it('reads the home batting order when the home side bats the bottom half', () => {
    const matchup = deriveMatchup(
      liveState({ half: Half.Bottom, currentBatter: 'home-1', currentPitcher: 'away-p' }),
      ROSTER,
      GAME_CONTEXT,
    )
    expect(matchup.you.batter.name).toBe('J. WHITLOCK')
    expect(matchup.you.pitcher.name).toBe('G. PIKE')
    expect(matchup.you.dueUp).toEqual(['Q. BAKER', 'C. DIAZ'])
  })
})
