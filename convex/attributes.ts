import type { MlbHitterRow, MlbPitcherRow } from './mlbStats'

/**
 * Stat → 1–5 attribute normalization, the pure half (SAN-26,
 * docs/engine/attribute-normalization.md). Regress each rate toward the season's
 * league rate, then look it up in an absolute cut table. No I/O: `convex/normalize.ts`
 * reads the raw rows and writes the players.
 *
 * Rates are fractions (0.13, not 13). A value exactly on a band's edge takes the
 * better score, so every table reads "at least" or "at most" its edge.
 */

export type Score = 1 | 2 | 3 | 4 | 5

export interface HitterRates {
  iso: number
  kRate: number
  bbRate: number
}

export interface PitcherRates {
  kRate: number
  bbRate: number
  gbRate: number
  hrPer9: number
}

export interface LeagueRates {
  hitter: HitterRates
  pitcher: Omit<PitcherRates, 'hrPer9'> & { hrPerBf: number }
}

export interface HitterAttributes {
  power: Score
  contact: Score
  speed: Score
  eye: Score
}

export interface PitcherAttributes {
  velocity: Score
  movement: Score
  awareness: Score
  command: Score
}

/** Fewer competitive runs than this and the sprint speed is not trusted. */
export const SPEED_MIN_RUNS = 10

/** What a hitter's Speed and every pitcher's Awareness are when there is nothing to score. */
const MIDDLE: Score = 3

/** Plate appearances, at-bats or batters faced at which a rate is half noise (Carleton). */
const STABILIZATION = {
  hitterK: 60,
  hitterBb: 120,
  iso: 160,
  pitcherK: 70,
  pitcherBb: 170,
  groundBall: 70,
  homeRun: 1300,
}

/** The pitching line scales per nine innings: 27 outs. */
const OUTS_PER_NINE = 27

/** The edge each score begins at, best first. */
interface Cuts {
  five: number
  four: number
  three: number
  two: number
}

type Reaches = (value: number, edge: number) => boolean

const atLeast: Reaches = (value, edge) => value >= edge
const atMost: Reaches = (value, edge) => value <= edge

function band(value: number, cuts: Cuts, reaches: Reaches): Score {
  if (reaches(value, cuts.five)) return 5
  if (reaches(value, cuts.four)) return 4
  if (reaches(value, cuts.three)) return 3
  if (reaches(value, cuts.two)) return 2
  return 1
}

// Hitter and Velocity edges are the doc's (FanGraphs tiers). Command, HR/9 and GB%
// were recalibrated once on the 2026 pool so the league average scores 3 and both
// ends are populated; they stay fixed after that (ADR-0038).
const POWER: Cuts = { five: 0.23, four: 0.18, three: 0.135, two: 0.1 }
const CONTACT: Cuts = { five: 0.13, four: 0.18, three: 0.24, two: 0.28 }
const EYE: Cuts = { five: 0.14, four: 0.105, three: 0.07, two: 0.05 }
const SPRINT_SPEED: Cuts = { five: 29, four: 28, three: 26.5, two: 25 }
const VELOCITY: Cuts = { five: 0.28, four: 0.24, three: 0.2, two: 0.16 }
const COMMAND: Cuts = { five: 0.068, four: 0.077, three: 0.098, two: 0.112 }
const HR_PER_9: Cuts = { five: 1.0, four: 1.08, three: 1.25, two: 1.35 }
const GROUND_BALL: Cuts = { five: 0.52, four: 0.46, three: 0.4, two: 0.36 }

export const scorePower = (iso: number): Score => band(iso, POWER, atLeast)
export const scoreContact = (kRate: number): Score => band(kRate, CONTACT, atMost)
export const scoreEye = (bbRate: number): Score => band(bbRate, EYE, atLeast)
export const scoreSprintSpeed = (feetPerSecond: number): Score =>
  band(feetPerSecond, SPRINT_SPEED, atLeast)
export const scoreVelocity = (kRate: number): Score => band(kRate, VELOCITY, atLeast)
export const scoreCommand = (bbRate: number): Score => band(bbRate, COMMAND, atMost)
export const scoreHrPer9 = (hrPer9: number): Score => band(hrPer9, HR_PER_9, atMost)
export const scoreGroundBall = (gbRate: number): Score => band(gbRate, GROUND_BALL, atLeast)

/** The average of the two sub-scores, a half rounding up. */
export function combineMovement(hrPer9Score: Score, groundBallScore: Score): Score {
  return Math.round((hrPer9Score + groundBallScore) / 2) as Score
}

/** Pull a small sample's rate toward the league's: `(events + lg × C) / (attempts + C)`. */
export function regress(
  events: number,
  attempts: number,
  leagueRate: number,
  stabilization: number,
): number {
  return (events + leagueRate * stabilization) / (attempts + stabilization)
}

/** Total bases beyond singles: what ISO (TB − H) counts per at-bat. */
const extraBases = (row: MlbHitterRow): number => row.doubles + 2 * row.triples + 3 * row.homeRuns

const sum = <T>(rows: readonly T[], pick: (row: T) => number): number =>
  rows.reduce((total, row) => total + pick(row), 0)

/** One pooled rate, refusing a season whose rows never reached the denominator. */
function pooled<T>(
  rows: readonly T[],
  events: (row: T) => number,
  attempts: (row: T) => number,
  denominator: string,
): number {
  const total = sum(rows, attempts)
  if (total === 0) throw new RangeError(`the season has no ${denominator}, so no league rate`)
  return sum(rows, events) / total
}

/** Every rate pooled over all of the season's rows of that role; throws if the pool is empty. */
export function leagueRates(
  hitters: readonly MlbHitterRow[],
  pitchers: readonly MlbPitcherRow[],
): LeagueRates {
  const plateAppearances = (row: MlbHitterRow) => row.plateAppearances
  const battersFaced = (row: MlbPitcherRow) => row.battersFaced
  return {
    hitter: {
      iso: pooled(hitters, extraBases, (row) => row.atBats, 'hitters with at-bats'),
      kRate: pooled(
        hitters,
        (row) => row.strikeOuts,
        plateAppearances,
        'hitters with plate appearances',
      ),
      bbRate: pooled(
        hitters,
        (row) => row.baseOnBalls,
        plateAppearances,
        'hitters with plate appearances',
      ),
    },
    pitcher: {
      kRate: pooled(pitchers, (row) => row.strikeOuts, battersFaced, 'pitchers who faced a batter'),
      bbRate: pooled(
        pitchers,
        (row) => row.baseOnBalls,
        battersFaced,
        'pitchers who faced a batter',
      ),
      gbRate: pooled(
        pitchers,
        (row) => row.groundHits + row.groundOuts,
        (row) => row.ballsInPlay,
        'balls in play',
      ),
      hrPerBf: pooled(pitchers, (row) => row.homeRuns, battersFaced, 'pitchers who faced a batter'),
    },
  }
}

export function hitterRates(row: MlbHitterRow, league: LeagueRates): HitterRates {
  const { iso, kRate, bbRate } = league.hitter
  return {
    iso: regress(extraBases(row), row.atBats, iso, STABILIZATION.iso),
    kRate: regress(row.strikeOuts, row.plateAppearances, kRate, STABILIZATION.hitterK),
    bbRate: regress(row.baseOnBalls, row.plateAppearances, bbRate, STABILIZATION.hitterBb),
  }
}

/** Throws for a pitcher with no outs: the per-nine scaling would divide by zero. */
export function pitcherRates(row: MlbPitcherRow, league: LeagueRates): PitcherRates {
  if (row.outs <= 0) {
    throw new RangeError(`${row.name} (${row.mlbId}) has no outs recorded, so HR/9 is undefined`)
  }
  const { kRate, bbRate, gbRate, hrPerBf } = league.pitcher
  const homeRunsPerBatter = regress(row.homeRuns, row.battersFaced, hrPerBf, STABILIZATION.homeRun)
  return {
    kRate: regress(row.strikeOuts, row.battersFaced, kRate, STABILIZATION.pitcherK),
    bbRate: regress(row.baseOnBalls, row.battersFaced, bbRate, STABILIZATION.pitcherBb),
    gbRate: regress(
      row.groundHits + row.groundOuts,
      row.ballsInPlay,
      gbRate,
      STABILIZATION.groundBall,
    ),
    hrPer9: homeRunsPerBatter * ((row.battersFaced * OUTS_PER_NINE) / row.outs),
  }
}

function speedOf(row: MlbHitterRow): Score {
  const { sprintSpeed, competitiveRuns } = row
  if (sprintSpeed === undefined || competitiveRuns === undefined) return MIDDLE
  return competitiveRuns < SPEED_MIN_RUNS ? MIDDLE : scoreSprintSpeed(sprintSpeed)
}

export function hitterAttributes(row: MlbHitterRow, league: LeagueRates): HitterAttributes {
  const { iso, kRate, bbRate } = hitterRates(row, league)
  return {
    power: scorePower(iso),
    contact: scoreContact(kRate),
    speed: speedOf(row),
    eye: scoreEye(bbRate),
  }
}

export function pitcherAttributes(row: MlbPitcherRow, league: LeagueRates): PitcherAttributes {
  const { kRate, bbRate, gbRate, hrPer9 } = pitcherRates(row, league)
  return {
    velocity: scoreVelocity(kRate),
    movement: combineMovement(scoreHrPer9(hrPer9), scoreGroundBall(gbRate)),
    awareness: MIDDLE,
    command: scoreCommand(bbRate),
  }
}
