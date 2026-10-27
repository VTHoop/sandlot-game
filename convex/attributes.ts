import type { MlbHitterRow, MlbPitcherRow } from './mlbStats'

/**
 * Stat → 1–5 attribute normalization, the pure half (SAN-26,
 * docs/engine/attribute-normalization.md). Regress each rate toward the season's
 * league rate, then look it up in an absolute cut table. No I/O: `convex/normalize.ts`
 * reads the raw rows and writes the players.
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

function notImplemented(): never {
  throw new Error('not implemented')
}

export const SPEED_MIN_RUNS = 10

export function regress(
  _events: number,
  _attempts: number,
  _leagueRate: number,
  _stabilization: number,
): number {
  return notImplemented()
}

export function leagueRates(
  _hitters: readonly MlbHitterRow[],
  _pitchers: readonly MlbPitcherRow[],
): LeagueRates {
  return notImplemented()
}

export function hitterRates(_row: MlbHitterRow, _league: LeagueRates): HitterRates {
  return notImplemented()
}

export function pitcherRates(_row: MlbPitcherRow, _league: LeagueRates): PitcherRates {
  return notImplemented()
}

export function scorePower(_iso: number): Score {
  return notImplemented()
}

export function scoreContact(_kRate: number): Score {
  return notImplemented()
}

export function scoreEye(_bbRate: number): Score {
  return notImplemented()
}

export function scoreSprintSpeed(_feetPerSecond: number): Score {
  return notImplemented()
}

export function scoreVelocity(_kRate: number): Score {
  return notImplemented()
}

export function combineMovement(_hrPer9Score: Score, _gbScore: Score): Score {
  return notImplemented()
}

export function hitterAttributes(_row: MlbHitterRow, _league: LeagueRates): HitterAttributes {
  return notImplemented()
}

export function pitcherAttributes(_row: MlbPitcherRow, _league: LeagueRates): PitcherAttributes {
  return notImplemented()
}
