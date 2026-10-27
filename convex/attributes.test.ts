import { describe, expect, it } from 'vitest'
import {
  combineMovement,
  hitterAttributes,
  hitterRates,
  type LeagueRates,
  leagueRates,
  pitcherAttributes,
  pitcherRates,
  regress,
  type Score,
  scoreCommand,
  scoreContact,
  scoreEye,
  scoreGroundBall,
  scoreHrPer9,
  scorePower,
  scoreSprintSpeed,
  scoreVelocity,
} from './attributes'
import type { MlbHitterRow, MlbPitcherRow } from './mlbStats'

/**
 * Stat → attribute scoring (SAN-26). Every row here is a fictional player with
 * invented numbers; the expected values are worked by hand in the comments.
 */

const hitter = (over: Partial<MlbHitterRow> = {}): MlbHitterRow => ({
  role: 'hitter',
  mlbId: 1,
  name: 'Ada Quill',
  season: 2026,
  team: 'Harbor Gulls',
  numTeams: 1,
  position: 'SS',
  plateAppearances: 600,
  atBats: 540,
  hits: 150,
  doubles: 30,
  triples: 3,
  homeRuns: 25,
  strikeOuts: 120,
  baseOnBalls: 50,
  stolenBases: 12,
  caughtStealing: 4,
  ...over,
})

const pitcher = (over: Partial<MlbPitcherRow> = {}): MlbPitcherRow => ({
  role: 'pitcher',
  mlbId: 2,
  name: 'Gus Larkin',
  season: 2026,
  team: 'Harbor Gulls',
  numTeams: 1,
  position: 'P',
  battersFaced: 700,
  outs: 540,
  strikeOuts: 180,
  baseOnBalls: 55,
  homeRuns: 20,
  groundHits: 90,
  groundOuts: 210,
  ballsInPlay: 480,
  ...over,
})

const league: LeagueRates = {
  hitter: { iso: 0.15, kRate: 0.22, bbRate: 0.08 },
  pitcher: { kRate: 0.22, bbRate: 0.085, gbRate: 0.43, hrPerBf: 0.03 },
}

describe('regress', () => {
  it('is (events + lg × C) / (attempts + C)', () => {
    // (30 + 0.2 × 60) / (100 + 60)
    expect(regress(30, 100, 0.2, 60)).toBeCloseTo(0.2625, 10)
  })

  it('is the league rate when there are no attempts', () => {
    expect(regress(0, 0, 0.2, 60)).toBeCloseTo(0.2, 10)
  })
})

describe('leagueRates', () => {
  // Hitters pooled: K 110 / PA 600; BB 50 / PA 600; (TB − H) = 2B + 2·3B + 3·HR,
  // so A = 20 + 0 + 30 = 50 and B = 10 + 4 + 12 = 26, over 450 + 90 = 540 AB.
  const hitters = [
    hitter({
      plateAppearances: 500,
      atBats: 450,
      hits: 100,
      doubles: 20,
      triples: 0,
      homeRuns: 10,
      strikeOuts: 100,
      baseOnBalls: 40,
    }),
    hitter({
      mlbId: 3,
      plateAppearances: 100,
      atBats: 90,
      hits: 30,
      doubles: 10,
      triples: 2,
      homeRuns: 4,
      strikeOuts: 10,
      baseOnBalls: 10,
    }),
  ]
  // Pitchers pooled: K 120 / BF 500; BB 40 / BF 500; HR 15 / BF 500;
  // GB = (ground hits + ground outs) / BIP = (60 + 100 + 10 + 30) / (250 + 60).
  const pitchers = [
    pitcher({
      battersFaced: 400,
      strikeOuts: 100,
      baseOnBalls: 30,
      homeRuns: 10,
      groundHits: 60,
      groundOuts: 100,
      ballsInPlay: 250,
    }),
    pitcher({
      mlbId: 4,
      battersFaced: 100,
      strikeOuts: 20,
      baseOnBalls: 10,
      homeRuns: 5,
      groundHits: 10,
      groundOuts: 30,
      ballsInPlay: 60,
    }),
  ]

  it('pools every hitter in the season', () => {
    const { hitter: lg } = leagueRates(hitters, pitchers)
    expect(lg.kRate).toBeCloseTo(110 / 600, 10)
    expect(lg.bbRate).toBeCloseTo(50 / 600, 10)
    expect(lg.iso).toBeCloseTo(76 / 540, 10)
  })

  it('pools every pitcher in the season', () => {
    const { pitcher: lg } = leagueRates(hitters, pitchers)
    expect(lg.kRate).toBeCloseTo(120 / 500, 10)
    expect(lg.bbRate).toBeCloseTo(40 / 500, 10)
    expect(lg.hrPerBf).toBeCloseTo(15 / 500, 10)
    expect(lg.gbRate).toBeCloseTo(200 / 310, 10)
  })
})

describe('leagueRates with nothing to pool', () => {
  it('refuses a season with no hitters rather than dividing by zero', () => {
    expect(() => leagueRates([], [pitcher()])).toThrow(/hitters/)
  })

  it('refuses a season with no pitchers rather than dividing by zero', () => {
    expect(() => leagueRates([hitter()], [])).toThrow(/pitchers/)
  })

  it('refuses a pitching pool that never put a ball in play', () => {
    const noBallsInPlay = pitcher({ ballsInPlay: 0, groundHits: 0, groundOuts: 0 })
    expect(() => leagueRates([hitter()], [noBallsInPlay])).toThrow(/balls in play/)
  })
})

describe('hitterRates', () => {
  // ISO events = 30 + 2·3 + 3·25 = 111 → (111 + 0.15 × 160) / (540 + 160)
  // K%  = (120 + 0.22 × 60) / (600 + 60); BB% = (50 + 0.08 × 120) / (600 + 120)
  it('regresses ISO, K% and BB% with their own stabilization points', () => {
    const rates = hitterRates(hitter(), league)
    expect(rates.iso).toBeCloseTo(135 / 700, 10)
    expect(rates.kRate).toBeCloseTo(133.2 / 660, 10)
    expect(rates.bbRate).toBeCloseTo(59.6 / 720, 10)
  })
})

describe('pitcherRates', () => {
  // K%  = (180 + 0.22 × 70) / (700 + 70); BB% = (55 + 0.085 × 170) / (700 + 170)
  // GB% = (300 + 0.43 × 70) / (480 + 70)
  // HR/9 = (20 + 0.03 × 1300) / (700 + 1300) × (700 BF ÷ (540 outs ÷ 27))
  it('regresses K%, BB% and GB%, and scales regressed HR per BF to per 9', () => {
    const rates = pitcherRates(pitcher(), league)
    expect(rates.kRate).toBeCloseTo(195.4 / 770, 10)
    expect(rates.bbRate).toBeCloseTo(69.45 / 870, 10)
    expect(rates.gbRate).toBeCloseTo(330.1 / 550, 10)
    expect(rates.hrPer9).toBeCloseTo((59 / 2000) * 35, 10)
  })

  it('refuses a pitcher with no outs recorded: HR/9 has no innings to scale by', () => {
    expect(() => pitcherRates(pitcher({ outs: 0 }), league)).toThrow(/outs/)
  })
})

type Case = readonly [value: number, score: Score]

/** Each table's band edges and the value just inside the next band. */
const TABLES: readonly (readonly [string, (value: number) => Score, readonly Case[]])[] = [
  [
    'Power (ISO, higher is better)',
    scorePower,
    [
      [0.23, 5],
      [0.2299, 4],
      [0.18, 4],
      [0.1799, 3],
      [0.135, 3],
      [0.1349, 2],
      [0.1, 2],
      [0.0999, 1],
    ],
  ],
  [
    'Contact (K%, lower is better)',
    scoreContact,
    [
      [0.13, 5],
      [0.1301, 4],
      [0.18, 4],
      [0.1801, 3],
      [0.24, 3],
      [0.2401, 2],
      [0.28, 2],
      [0.2801, 1],
    ],
  ],
  [
    'Eye (BB%, higher is better)',
    scoreEye,
    [
      [0.14, 5],
      [0.1399, 4],
      [0.105, 4],
      [0.1049, 3],
      [0.07, 3],
      [0.0699, 2],
      [0.05, 2],
      [0.0499, 1],
    ],
  ],
  [
    'Speed (sprint speed, higher is better)',
    scoreSprintSpeed,
    [
      [29, 5],
      [28.99, 4],
      [28, 4],
      [27.99, 3],
      [26.5, 3],
      [26.49, 2],
      [25, 2],
      [24.99, 1],
    ],
  ],
  [
    'Velocity (K%, higher is better)',
    scoreVelocity,
    [
      [0.28, 5],
      [0.2799, 4],
      [0.24, 4],
      [0.2399, 3],
      [0.2, 3],
      [0.1999, 2],
      [0.16, 2],
      [0.1599, 1],
    ],
  ],
  [
    'Command (BB%, lower is better)',
    scoreCommand,
    [
      [0.068, 5],
      [0.0681, 4],
      [0.077, 4],
      [0.0771, 3],
      [0.098, 3],
      [0.0981, 2],
      [0.112, 2],
      [0.1121, 1],
    ],
  ],
  [
    'Movement: HR/9 (lower is better)',
    scoreHrPer9,
    [
      [1.0, 5],
      [1.001, 4],
      [1.08, 4],
      [1.081, 3],
      [1.25, 3],
      [1.251, 2],
      [1.35, 2],
      [1.351, 1],
    ],
  ],
  [
    'Movement: GB% (higher is better)',
    scoreGroundBall,
    [
      [0.52, 5],
      [0.5199, 4],
      [0.46, 4],
      [0.4599, 3],
      [0.4, 3],
      [0.3999, 2],
      [0.36, 2],
      [0.3599, 1],
    ],
  ],
]

describe.each(TABLES)('%s', (_name, score, cases) => {
  it.each(
    cases,
  )('%s scores %s — a value exactly on a boundary takes the better score', (value, expected) => {
    expect(score(value)).toBe(expected)
  })
})

describe('a league-average pitcher (2026 pooled rates)', () => {
  // The season's pooled pitching line: K% .2214, BB% .0889, GB% .4237, HR/BF .0303
  // over 38.4 batters faced per nine. A pitcher sitting exactly on it must be a 3
  // everywhere — the tables are absolute, so this is what pins them to the season.
  const season: LeagueRates = {
    hitter: { iso: 0.1565, kRate: 0.2214, bbRate: 0.0889 },
    pitcher: { kRate: 0.2214, bbRate: 0.0889, gbRate: 0.4237, hrPerBf: 0.0303 },
  }
  const average = pitcher({
    battersFaced: 700,
    outs: 492, // 700 BF × 27 ÷ 492 = 38.4 BF per nine
    strikeOuts: 155,
    baseOnBalls: 62,
    homeRuns: 21,
    groundHits: 93,
    groundOuts: 110,
    ballsInPlay: 480,
  })

  it('scores 3 on Velocity, Command, Movement and Awareness', () => {
    expect(pitcherAttributes(average, season)).toEqual({
      velocity: 3,
      movement: 3,
      awareness: 3,
      command: 3,
    })
  })

  it('is exactly the league on HR/9 (≈1.165) and scores that HR/9 a 3', () => {
    expect(pitcherRates(average, season).hrPer9).toBeCloseTo(1.165, 1)
    expect(scoreHrPer9(1.165)).toBe(3)
  })
})

describe('combineMovement', () => {
  it.each<[Score, Score, Score]>([
    [5, 5, 5],
    [5, 4, 5], // 4.5 rounds up
    [4, 3, 4],
    [3, 2, 3],
    [2, 1, 2],
    [1, 4, 3], // 2.5 rounds up
    [1, 3, 2],
    [3, 3, 3],
    [1, 1, 1],
  ])('HR/9 %s with GB%% %s is %s', (hr, gb, expected) => {
    expect(combineMovement(hr, gb)).toBe(expected)
    expect(combineMovement(gb, hr)).toBe(expected)
  })
})

describe('hitterAttributes', () => {
  it('scores each attribute from its regressed driver', () => {
    // ISO .1929 → 4, K% .2018 → 3, BB% .0828 → 3, 28.3 ft/s over 40 runs → 4
    const row = hitter({ sprintSpeed: 28.3, competitiveRuns: 40 })
    expect(hitterAttributes(row, league)).toEqual({ power: 4, contact: 3, speed: 4, eye: 3 })
  })

  it('regresses before bucketing: one strikeout in one PA is not Contact 1', () => {
    // raw K% is 100%; regressed (1 + 0.22 × 60) / 61 = .2328 → 3
    const row = hitter({ plateAppearances: 1, atBats: 1, hits: 0, strikeOuts: 1, baseOnBalls: 0 })
    expect(hitterAttributes(row, league).contact).toBe(3)
  })

  it('does not regress sprint speed', () => {
    const row = hitter({ sprintSpeed: 29, competitiveRuns: 10 })
    expect(hitterAttributes(row, league).speed).toBe(5)
  })

  it('gives Speed 3 with fewer than 10 competitive runs', () => {
    const row = hitter({ sprintSpeed: 29.5, competitiveRuns: 9 })
    expect(hitterAttributes(row, league).speed).toBe(3)
  })

  it('gives Speed 3 with no sprint-speed record', () => {
    expect(hitterAttributes(hitter(), league).speed).toBe(3)
  })
})

describe('pitcherAttributes', () => {
  it('scores Velocity from the regressed K%', () => {
    // (180 + 0.22 × 70) / 770 = .2538 → 4
    expect(pitcherAttributes(pitcher(), league).velocity).toBe(4)
  })

  it('regresses before bucketing: one strikeout in one batter is not Velocity 5', () => {
    // raw K% is 100%; regressed (1 + 0.22 × 70) / 71 = .2310 → 3
    const row = pitcher({ battersFaced: 1, outs: 1, strikeOuts: 1, baseOnBalls: 0, homeRuns: 0 })
    expect(pitcherAttributes(row, league).velocity).toBe(3)
  })

  it('gives every pitcher Awareness 3', () => {
    expect(pitcherAttributes(pitcher(), league).awareness).toBe(3)
    expect(pitcherAttributes(pitcher({ strikeOuts: 0, outs: 900 }), league).awareness).toBe(3)
  })
})
