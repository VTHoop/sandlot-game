import { type BaseState, GroundBallResult, type HitterAttributes } from '@sandlot/engine/atBat'
import { GameStatus, Half, type LiveGameState } from '@sandlot/engine/game'
import { OUTCOME_BAND_KEYS, type OutcomeBandKey } from '@sandlot/engine/outcomes'
import { describe, expect, it } from 'vitest'
import { OUTCOME_LADDER, type OutcomeKey } from '../components/ui/OutcomeLadder'
import {
  accumulateHits,
  assembleRunnerSpeeds,
  type Board,
  createDuelAdapter,
  deriveHeadline,
  deriveMatchup,
  deriveRunnerMovements,
  deriveScoreline,
  deriveSituation,
  GbHeadline,
  OUTCOME_KEY_BY_BAND,
  resolveDuelAtBat,
  toOutcomeKey,
} from './adapter'
import { CLUB_NAMES, GAME_CONTEXT, ROSTER, type Roster, type RosterPlayer } from './roster'
import { FieldSpot, type RunnerMovement } from './scenario'

/** The fixture clubs as the scoreboard labels them, with nobody having hit yet. */
const CLUBS = { away: 'HAR', home: 'RID' } as const
const board = (hits = { away: 0, home: 0 }): Board => ({ clubs: CLUBS, hits })

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
  // 'b'; `basesAfter` is what reaches base after the play. The line names the
  // batter in the third person, so it reads the same from either seat (SAN-39).
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
      expected: 'R. VANCE stands on 1st',
    },
    {
      name: 'a run-scoring double: runs and landing base',
      outcome: '2B',
      basesAfter: { first: null, second: 'b', third: null },
      runsScored: 1,
      expected: '1 run scores · R. VANCE stands on 2nd',
    },
    {
      name: 'a run-scoring triple: the batter ends up on third',
      outcome: '3B',
      basesAfter: { first: null, second: null, third: 'b' },
      runsScored: 2,
      expected: '2 runs score · R. VANCE stands on 3rd',
    },
    {
      name: 'a grand slam: pluralized runs, batter cleared the bases',
      outcome: 'HR',
      basesAfter: { first: null, second: null, third: null },
      runsScored: 4,
      expected: '4 runs score · R. VANCE goes yard',
    },
    {
      name: 'a bases-loaded walk: a forced run plus reaching first',
      outcome: 'BB',
      basesAfter: { first: 'b', second: 'x', third: 'y' },
      runsScored: 1,
      expected: '1 run scores · R. VANCE reaches 1st',
    },
    {
      name: 'a strikeout: the out phrasing, no runs',
      outcome: 'K',
      basesAfter: { first: null, second: null, third: null },
      runsScored: 0,
      expected: 'R. VANCE strikes out',
    },
    {
      name: 'a fly out: its out phrasing',
      outcome: 'FO',
      basesAfter: { first: null, second: null, third: null },
      runsScored: 0,
      expected: 'R. VANCE flies out',
    },
    {
      name: 'a pop out: its out phrasing',
      outcome: 'PO',
      basesAfter: { first: null, second: null, third: null },
      runsScored: 0,
      expected: 'R. VANCE pops out',
    },
    {
      name: 'a groundout: its out phrasing',
      outcome: 'GB',
      basesAfter: { first: null, second: null, third: null },
      runsScored: 0,
      expected: 'R. VANCE grounds out',
    },
  ]

  it.each(cases)('$name', ({ outcome, basesAfter, runsScored, expected }) => {
    expect(
      deriveScoreline({ outcome, basesAfter, runsScored, batter: 'b', batterName: 'R. VANCE' }),
    ).toBe(expected)
  })
})

describe('deriveHeadline', () => {
  it('reads the plain outcome name when there is no groundball sub-result', () => {
    expect(deriveHeadline('K', null)).toBe('STRIKEOUT')
    expect(deriveHeadline('HR', null)).toBe('HOME RUN!')
    expect(deriveHeadline('BB', null)).toBe('WALK')
  })

  // The bug: every groundball sub-result read "GROUNDOUT", so a double play looked
  // like a routine out. Each sub-result now names itself.
  const gbCases: Array<{ result: GroundBallResult; expected: GbHeadline }> = [
    { result: GroundBallResult.GO, expected: GbHeadline.Groundout },
    { result: GroundBallResult.GO_RA, expected: GbHeadline.Groundout },
    { result: GroundBallResult.FC, expected: GbHeadline.FieldersChoice },
    { result: GroundBallResult.FC_2ND, expected: GbHeadline.FieldersChoice },
    { result: GroundBallResult.FC_3RD, expected: GbHeadline.FieldersChoice },
    { result: GroundBallResult.FC_HOME, expected: GbHeadline.FieldersChoice },
    { result: GroundBallResult.DP, expected: GbHeadline.DoublePlay },
    { result: GroundBallResult.TP, expected: GbHeadline.TriplePlay },
  ]

  it.each(gbCases)('names a groundball $result as "$expected"', ({ result, expected }) => {
    expect(deriveHeadline('GB', result)).toBe(expected)
  })
})

describe('deriveRunnerMovements', () => {
  const empty: BaseState = { first: null, second: null, third: null }
  // Each case traces every runner (and the batter) from before → after by identity,
  // in lead order (third → batter). Departed runners score frontmost-first up to
  // `runsScored`; the rest are outs.
  const cases: Array<{
    name: string
    basesBefore: BaseState
    basesAfter: BaseState
    runsScored: number
    groundBallResult: GroundBallResult | null
    expected: RunnerMovement[]
  }> = [
    {
      name: 'a strikeout, empty bases: only the batter, retired in place at the plate',
      basesBefore: empty,
      basesAfter: empty,
      runsScored: 0,
      groundBallResult: null,
      expected: [{ from: FieldSpot.Batter, to: FieldSpot.Batter, retired: true }],
    },
    {
      name: 'a single, empty bases: the batter reaches first',
      basesBefore: empty,
      basesAfter: { first: 'b', second: null, third: null },
      runsScored: 0,
      groundBallResult: null,
      expected: [{ from: FieldSpot.Batter, to: FieldSpot.First, retired: false }],
    },
    {
      name: 'a double scoring the runner from second',
      basesBefore: { first: null, second: 'r2', third: null },
      basesAfter: { first: null, second: 'b', third: null },
      runsScored: 1,
      groundBallResult: null,
      expected: [
        { from: FieldSpot.Second, to: FieldSpot.Home, retired: false },
        { from: FieldSpot.Batter, to: FieldSpot.Second, retired: false },
      ],
    },
    {
      name: 'a grand slam: all four cross the plate',
      basesBefore: { first: 'r1', second: 'r2', third: 'r3' },
      basesAfter: empty,
      runsScored: 4,
      groundBallResult: null,
      expected: [
        { from: FieldSpot.Third, to: FieldSpot.Home, retired: false },
        { from: FieldSpot.Second, to: FieldSpot.Home, retired: false },
        { from: FieldSpot.First, to: FieldSpot.Home, retired: false },
        { from: FieldSpot.Batter, to: FieldSpot.Home, retired: false },
      ],
    },
    {
      name: 'a sac fly: the lead runner scores, the batter is out in place at the plate',
      basesBefore: { first: null, second: null, third: 'r3' },
      basesAfter: empty,
      runsScored: 1,
      groundBallResult: null,
      expected: [
        { from: FieldSpot.Third, to: FieldSpot.Home, retired: false },
        { from: FieldSpot.Batter, to: FieldSpot.Batter, retired: true },
      ],
    },
    {
      name: 'GO, bases empty: the batter is forced out at first',
      basesBefore: empty,
      basesAfter: empty,
      runsScored: 0,
      groundBallResult: GroundBallResult.GO,
      expected: [{ from: FieldSpot.Batter, to: FieldSpot.First, retired: true }],
    },
    {
      name: 'GO_RA: out at first, the runner on third scores as the batter is forced there',
      basesBefore: { first: null, second: null, third: 'r3' },
      basesAfter: empty,
      runsScored: 1,
      groundBallResult: GroundBallResult.GO_RA,
      expected: [
        { from: FieldSpot.Third, to: FieldSpot.Home, retired: false },
        { from: FieldSpot.Batter, to: FieldSpot.First, retired: true },
      ],
    },
    {
      name: 'FC: the runner from first is out at second, the batter is safe at first',
      basesBefore: { first: 'r1', second: null, third: null },
      basesAfter: { first: 'b', second: null, third: null },
      runsScored: 0,
      groundBallResult: GroundBallResult.FC,
      expected: [
        { from: FieldSpot.First, to: FieldSpot.Second, retired: true },
        { from: FieldSpot.Batter, to: FieldSpot.First, retired: false },
      ],
    },
    {
      name: 'FC_2ND: runner from first out at second, the runner ahead takes third',
      basesBefore: { first: 'r1', second: 'r2', third: null },
      basesAfter: { first: 'b', second: null, third: 'r2' },
      runsScored: 0,
      groundBallResult: GroundBallResult.FC_2ND,
      expected: [
        { from: FieldSpot.Second, to: FieldSpot.Third, retired: false },
        { from: FieldSpot.First, to: FieldSpot.Second, retired: true },
        { from: FieldSpot.Batter, to: FieldSpot.First, retired: false },
      ],
    },
    {
      name: 'FC_3RD: the runner from second is out at third, the trailers are safe',
      basesBefore: { first: 'r1', second: 'r2', third: null },
      basesAfter: { first: 'b', second: 'r1', third: null },
      runsScored: 0,
      groundBallResult: GroundBallResult.FC_3RD,
      expected: [
        { from: FieldSpot.Second, to: FieldSpot.Third, retired: true },
        { from: FieldSpot.First, to: FieldSpot.Second, retired: false },
        { from: FieldSpot.Batter, to: FieldSpot.First, retired: false },
      ],
    },
    {
      name: 'FC_HOME: the runner from third is out AT HOME, never counted as a run',
      basesBefore: { first: 'r1', second: 'r2', third: 'r3' },
      basesAfter: { first: 'b', second: 'r1', third: 'r2' },
      runsScored: 0,
      groundBallResult: GroundBallResult.FC_HOME,
      expected: [
        { from: FieldSpot.Third, to: FieldSpot.Home, retired: true },
        { from: FieldSpot.Second, to: FieldSpot.Third, retired: false },
        { from: FieldSpot.First, to: FieldSpot.Second, retired: false },
        { from: FieldSpot.Batter, to: FieldSpot.First, retired: false },
      ],
    },
    {
      name: 'a force double play: the trail runner is out at second, the batter at first',
      basesBefore: { first: 'r1', second: null, third: null },
      basesAfter: empty,
      runsScored: 0,
      groundBallResult: GroundBallResult.DP,
      expected: [
        { from: FieldSpot.First, to: FieldSpot.Second, retired: true },
        { from: FieldSpot.Batter, to: FieldSpot.First, retired: true },
      ],
    },
    {
      name: 'a triple play: every forced runner is out at the base ahead',
      basesBefore: { first: 'r1', second: 'r2', third: null },
      basesAfter: empty,
      runsScored: 0,
      groundBallResult: GroundBallResult.TP,
      expected: [
        { from: FieldSpot.Second, to: FieldSpot.Third, retired: true },
        { from: FieldSpot.First, to: FieldSpot.Second, retired: true },
        { from: FieldSpot.Batter, to: FieldSpot.First, retired: true },
      ],
    },
    {
      name: 'a strikeout with a runner holding on second',
      basesBefore: { first: null, second: 'r2', third: null },
      basesAfter: { first: null, second: 'r2', third: null },
      runsScored: 0,
      groundBallResult: null,
      expected: [
        { from: FieldSpot.Second, to: FieldSpot.Second, retired: false },
        { from: FieldSpot.Batter, to: FieldSpot.Batter, retired: true },
      ],
    },
    {
      name: 'a bases-loaded walk: the forced run scores, everyone else pushes up one',
      basesBefore: { first: 'r1', second: 'r2', third: 'r3' },
      basesAfter: { first: 'b', second: 'r1', third: 'r2' },
      runsScored: 1,
      groundBallResult: null,
      expected: [
        { from: FieldSpot.Third, to: FieldSpot.Home, retired: false },
        { from: FieldSpot.Second, to: FieldSpot.Third, retired: false },
        { from: FieldSpot.First, to: FieldSpot.Second, retired: false },
        { from: FieldSpot.Batter, to: FieldSpot.First, retired: false },
      ],
    },
  ]

  it.each(cases)('$name', ({ basesBefore, basesAfter, runsScored, groundBallResult, expected }) => {
    expect(
      deriveRunnerMovements({ basesBefore, basesAfter, batter: 'b', runsScored, groundBallResult }),
    ).toEqual(expected)
  })
})

describe('accumulateHits', () => {
  it('credits the club that was batting: away in the top half, home in the bottom', () => {
    expect(accumulateHits({ away: 0, home: 0 }, '1B', Half.Top)).toEqual({ away: 1, home: 0 })
    expect(accumulateHits({ away: 2, home: 1 }, 'HR', Half.Bottom)).toEqual({ away: 2, home: 2 })
  })

  it('leaves the totals untouched on a non-hit', () => {
    expect(accumulateHits({ away: 1, home: 0 }, 'K', Half.Top)).toEqual({ away: 1, home: 0 })
    expect(accumulateHits({ away: 1, home: 0 }, 'BB', Half.Bottom)).toEqual({ away: 1, home: 0 })
  })
})

describe('resolveDuelAtBat', () => {
  it('maps a hit to an AppliedAtBat and a RevealScenario', () => {
    const { applied, reveal } = resolveDuelAtBat(HIT_AT_BAT, liveState(), ROSTER, board())
    expect(applied).toEqual({
      sequence: 0,
      outsBefore: 0,
      outsAfter: 0,
      basesAfter: { first: 'away-1', second: null, third: null },
      runsScored: 0,
    })
    expect(reveal).toEqual({
      pitch: HIT_AT_BAT.pitch,
      swing: HIT_AT_BAT.swing,
      pitcher: 'H. MARSH',
      batter: 'R. VANCE',
      clubs: CLUBS,
      outcome: '1B',
      inning: 1,
      half: 'TOP',
      outs: 0,
      runsScored: 0,
      scoreBefore: { away: 0, home: 0 },
      hitsBefore: { away: 0, home: 0 },
      headline: 'SINGLE!',
      scoreline: 'R. VANCE stands on 1st',
      movements: [{ from: FieldSpot.Batter, to: FieldSpot.First, retired: false }],
    })
  })

  it('maps an out: a third strike records an out and no base runner', () => {
    const { applied, reveal } = resolveDuelAtBat(OUT_AT_BAT, liveState(), ROSTER, board())
    expect(reveal.outcome).toBe('K')
    expect(applied.outsAfter).toBe(1)
    expect(applied.basesAfter).toEqual({ first: null, second: null, third: null })
    expect(reveal.outs).toBe(1)
    expect(reveal.scoreline).toBe('R. VANCE strikes out')
  })

  it('maps a walk: the batter reaches first', () => {
    const { applied, reveal } = resolveDuelAtBat(WALK_AT_BAT, liveState(), ROSTER, board())
    expect(reveal.outcome).toBe('BB')
    expect(applied.basesAfter).toEqual({ first: 'away-1', second: null, third: null })
    expect(reveal.scoreline).toBe('R. VANCE reaches 1st')
  })

  it('threads the running hit totals into hitsBefore, club for club', () => {
    const { reveal } = resolveDuelAtBat(
      HIT_AT_BAT,
      liveState(),
      ROSTER,
      board({ away: 3, home: 2 }),
    )
    expect(reveal.hitsBefore).toEqual({ away: 3, home: 2 })
  })

  it('describes a bottom-half at-bat in the same absolute terms — nothing flips', () => {
    // The home club bats against the away pitcher. Scores stay away/home, the
    // numbers stay pitch/swing, and each player is named by what they did — so the
    // reveal reads the same to the club batting, the club pitching, and an owner of
    // both (SAN-39).
    const { reveal } = resolveDuelAtBat(
      HIT_AT_BAT,
      liveState({
        half: Half.Bottom,
        currentBatter: 'home-1',
        currentPitcher: 'away-p',
        homeScore: 2,
        awayScore: 5,
      }),
      ROSTER,
      board({ away: 4, home: 1 }),
    )
    expect(reveal.half).toBe('BOTTOM')
    expect(reveal.scoreBefore).toEqual({ away: 5, home: 2 })
    expect(reveal.hitsBefore).toEqual({ away: 4, home: 1 })
    expect(reveal.pitch).toBe(HIT_AT_BAT.pitch)
    expect(reveal.swing).toBe(HIT_AT_BAT.swing)
    expect(reveal.pitcher).toBe('G. PIKE')
    expect(reveal.batter).toBe('J. WHITLOCK')
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
    expect(() => resolveDuelAtBat(HIT_AT_BAT, state, ROSTER, board())).toThrow(error)
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
    const adapter = createDuelAdapter(roster, context, CLUB_NAMES)

    const first = adapter.playAtBat(HIT_AT_BAT.pitch, HIT_AT_BAT.swing)
    expect(first.reveal.outcome).toBe('1B')
    expect(first.reveal.hitsBefore).toEqual({ away: 0, home: 0 })
    expect(adapter.hits()).toEqual({ away: 1, home: 0 })

    const second = adapter.playAtBat(HIT_AT_BAT.pitch, HIT_AT_BAT.swing)
    expect(second.reveal.outcome).toBe('1B')
    // The first hit is now on the books before the second at-bat reveals.
    expect(second.reveal.hitsBefore).toEqual({ away: 1, home: 0 })
    expect(adapter.hits()).toEqual({ away: 2, home: 0 })

    // State advanced through the engine: two at-bats folded in, runner aboard.
    expect(adapter.state().lastResolvedSequence).toBe(1)
    expect(adapter.state().bases.first).toBeTruthy()
  })

  it('keeps each club’s hits its own when the third out flips the half', () => {
    const adapter = createDuelAdapter(roster, context, CLUB_NAMES)

    // Top half: the away side singles, then strikes out three times to end it.
    adapter.playAtBat(HIT_AT_BAT.pitch, HIT_AT_BAT.swing)
    expect(adapter.hits()).toEqual({ away: 1, home: 0 })
    adapter.playAtBat(OUT_AT_BAT.pitch, OUT_AT_BAT.swing)
    adapter.playAtBat(OUT_AT_BAT.pitch, OUT_AT_BAT.swing)
    adapter.playAtBat(OUT_AT_BAT.pitch, OUT_AT_BAT.swing)

    // The half flipped and nothing moved: the totals are absolute, so there is no
    // swap to get wrong.
    expect(adapter.state().half).toBe(Half.Bottom)
    expect(adapter.hits()).toEqual({ away: 1, home: 0 })

    const bottom = adapter.playAtBat(HIT_AT_BAT.pitch, HIT_AT_BAT.swing)
    expect(bottom.reveal.hitsBefore).toEqual({ away: 1, home: 0 })
    // The home club's hit lands on the home total.
    expect(adapter.hits()).toEqual({ away: 1, home: 1 })
  })

  it('labels the clubs with the first three letters of their names', () => {
    const adapter = createDuelAdapter(roster, context, {
      away: 'Harbor Kingfishers',
      home: 'Ridgeview Rail',
    })
    expect(adapter.clubs()).toEqual({ away: 'HAR', home: 'RID' })
    expect(adapter.playAtBat(HIT_AT_BAT.pitch, HIT_AT_BAT.swing).reveal.clubs).toEqual({
      away: 'HAR',
      home: 'RID',
    })
  })

  it('hands back defensive copies that cannot corrupt internal state', () => {
    const adapter = createDuelAdapter(roster, context, CLUB_NAMES)

    const snapState = adapter.state()
    snapState.outs = 2
    snapState.bases.first = 'tamper'
    const snapHits = adapter.hits()
    snapHits.away = 99

    // The adapter's own state is untouched by the mutated snapshots.
    expect(adapter.state().outs).toBe(0)
    expect(adapter.state().bases.first).toBeNull()
    expect(adapter.hits()).toEqual({ away: 0, home: 0 })
  })
})

describe('deriveSituation', () => {
  it('projects the non-secret situation in absolute terms', () => {
    const situation = deriveSituation(
      liveState({ awayScore: 2, homeScore: 1, outs: 1 }),
      board({ away: 3, home: 4 }),
      ROSTER,
    )
    expect(situation).toEqual({
      pitcher: 'H. MARSH',
      batter: 'R. VANCE',
      clubs: CLUBS,
      inning: 1,
      half: 'TOP',
      outs: 1,
      scoreBefore: { away: 2, home: 1 },
      hitsBefore: { away: 3, home: 4 },
      runnersOn: [],
    })
  })

  it('projects occupied bases in lead order so the commit field mirrors the live diamond', () => {
    const situation = deriveSituation(
      liveState({ bases: { first: 'away-1', second: null, third: 'away-2' } }),
      board(),
      ROSTER,
    )
    // Occupancy only (no runner identity), lead order like the reveal's starters.
    expect(situation.runnersOn).toEqual([FieldSpot.Third, FieldSpot.First])
  })

  it('projects a loaded diamond — every base branch, second included', () => {
    const situation = deriveSituation(
      liveState({ bases: { first: 'away-1', second: 'away-2', third: 'away-3' } }),
      board(),
      ROSTER,
    )
    expect(situation.runnersOn).toEqual([FieldSpot.Third, FieldSpot.Second, FieldSpot.First])
  })

  it('is structurally free of either duel number (secret-state law)', () => {
    const situation = deriveSituation(liveState(), board(), ROSTER)
    expect(situation).not.toHaveProperty('pitch')
    expect(situation).not.toHaveProperty('swing')
  })

  it('keeps the scores away/home once the home side bats the bottom half', () => {
    const situation = deriveSituation(
      liveState({
        half: Half.Bottom,
        awayScore: 5,
        homeScore: 3,
        currentBatter: 'home-1',
        currentPitcher: 'away-p',
      }),
      board(),
      ROSTER,
    )
    expect(situation.scoreBefore).toEqual({ away: 5, home: 3 })
    expect(situation.pitcher).toBe('G. PIKE')
    expect(situation.batter).toBe('J. WHITLOCK')
  })
})

describe('deriveMatchup', () => {
  it('names the one real pitcher-vs-batter matchup, mapping attrs to pips', () => {
    // One matchup, not a "you" side and an "opponent" side: both seats are looking
    // at the same two players.
    const matchup = deriveMatchup(liveState(), ROSTER, GAME_CONTEXT)
    expect(matchup.pitcher).toEqual({ name: 'H. MARSH', attrs: { VEL: 3, MOV: 3, CMD: 1 } })
    expect(matchup.batter).toEqual({
      name: 'R. VANCE',
      attrs: { PWR: 3, CON: 3, SPD: 3, EYE: 5 },
    })
    expect(matchup.dueUp).toEqual(['T. JULIEN', 'S. ORTIZ'])
  })

  it('reads the home batting order when the home side bats the bottom half', () => {
    const matchup = deriveMatchup(
      liveState({ half: Half.Bottom, currentBatter: 'home-1', currentPitcher: 'away-p' }),
      ROSTER,
      GAME_CONTEXT,
    )
    expect(matchup.batter.name).toBe('J. WHITLOCK')
    expect(matchup.pitcher.name).toBe('G. PIKE')
    expect(matchup.dueUp).toEqual(['Q. BAKER', 'C. DIAZ'])
  })
})
