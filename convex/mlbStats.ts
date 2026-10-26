import type { Infer } from 'convex/values'
import type { mlbHitterRow, mlbPitcherRow } from './validators'

/**
 * MLB season ingest, the pure half (SAN-25, ADR-0037): turns what the sources
 * returned into raw stat rows, and refuses anything incomplete. Red checkpoint:
 * the seam the tests are written against, with no behavior behind it yet.
 */

export type MlbHitterRow = Infer<typeof mlbHitterRow>
export type MlbPitcherRow = Infer<typeof mlbPitcherRow>

/** What a position is stored as when neither the stats nor the profile name one. */
export const UNKNOWN_POSITION = 'unknown'

/** Every source the ingest reads; an abort names the one that failed. */
export type IngestSource =
  | 'seasons'
  | 'hitting'
  | 'pitching'
  | 'pitching-advanced'
  | 'profiles'
  | 'sprint-speed'

/** The run aborted: a source failed, came back empty, or lacked a required field. */
export class IngestError extends Error {
  constructor(source: IngestSource, detail: string) {
    super(`Ingest aborted: ${source}: ${detail}`)
    this.name = 'IngestError'
  }
}

export interface SeasonSources {
  season: number
  /** Parsed JSON of the `stats=season&group=hitting` response. */
  hitting: unknown
  /** Parsed JSON of the `stats=season&group=pitching` response. */
  pitching: unknown
  /** Parsed JSON of the `stats=seasonAdvanced&group=pitching` response. */
  pitchingAdvanced: unknown
  /** Parsed JSON of the `/people` response; null when no position needed a lookup. */
  profiles: unknown
  /** The Savant sprint-speed leaderboard, as the CSV text it downloads as. */
  sprintCsv: string
}

/** The most recent season whose regular season ended before `today`. */
export function latestCompletedSeason(_seasons: unknown, _today: Date): number {
  throw new Error('latestCompletedSeason is not implemented')
}

/** MLB ids whose reported position is unknown (`X`), across both groups. */
export function unknownPositionIds(_hitting: unknown, _pitching: unknown): number[] {
  throw new Error('unknownPositionIds is not implemented')
}

export function buildSeasonRows(_sources: SeasonSources): {
  hitters: MlbHitterRow[]
  pitchers: MlbPitcherRow[]
} {
  throw new Error('buildSeasonRows is not implemented')
}
