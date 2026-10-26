import type { Infer } from 'convex/values'
import { Fields, IngestError, type IngestSource } from './mlbFields'
import { parseSprintSpeeds, type SprintRecord } from './sprintSpeed'
import type { mlbHitterRow, mlbPitcherRow } from './validators'

/**
 * MLB season ingest, the pure half (SAN-25, ADR-0037): turns what the sources
 * returned into raw stat rows, and refuses anything incomplete. No I/O here —
 * `convex/ingest.ts` fetches, this reads.
 */

export { IngestError, type IngestSource }

export type MlbHitterRow = Infer<typeof mlbHitterRow>
export type MlbPitcherRow = Infer<typeof mlbPitcherRow>

/** What a position is stored as when neither the stats nor the profile name one. */
export const UNKNOWN_POSITION = 'unknown'

/** The Stats API's "position not reported" abbreviation. */
const UNREPORTED_POSITION = 'X'

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

const dayOf = (date: Date): string => date.toISOString().slice(0, 10)

/** The most recent season whose regular season ended before `today` (UTC). */
export function latestCompletedSeason(seasons: unknown, today: Date): number {
  const records = Fields.of('seasons', 'response', seasons).list('seasons')
  if (records.length === 0) throw new IngestError('seasons', 'returned no seasons')
  const ended = records
    .map((record) => ({
      year: Number(record.text('seasonId')),
      lastGame: record.text('regularSeasonEndDate'),
    }))
    .filter(({ lastGame }) => lastGame < dayOf(today))
  if (ended.length === 0) throw new IngestError('seasons', 'no regular season has ended yet')
  return Math.max(...ended.map(({ year }) => year))
}

/** The players of one stats response, as the API lists them. */
function splitsOf(source: IngestSource, response: unknown): Fields[] {
  const [group] = Fields.of(source, 'response', response).list('stats')
  const splits = group?.list('splits') ?? []
  if (splits.length === 0) throw new IngestError(source, 'returned no players')
  return splits
}

const mlbIdOf = (split: Fields): number => split.child('player').count('id')

/** A group's players by MLB id; the API lists each once, so a repeat is a bad response. */
function byMlbId(source: IngestSource, response: unknown): Map<number, Fields> {
  const players = new Map<number, Fields>()
  for (const split of splitsOf(source, response)) {
    const id = mlbIdOf(split)
    if (players.has(id)) throw new IngestError(source, `player ${id} is listed twice`)
    players.set(id, split)
  }
  return players
}

/** The abbreviation the stats report, or null when none is reported. */
function reportedPosition(split: Fields): string | null {
  const abbreviation = split.optionalChild('position')?.text('abbreviation') ?? null
  return abbreviation === UNREPORTED_POSITION ? null : abbreviation
}

/** MLB ids whose position the stats do not report, across both groups, ascending. */
export function unknownPositionIds(hitting: unknown, pitching: unknown): number[] {
  const unknown = new Set<number>()
  for (const [source, response] of [
    ['hitting', hitting],
    ['pitching', pitching],
  ] as const) {
    for (const split of splitsOf(source, response)) {
      if (reportedPosition(split) === null) unknown.add(mlbIdOf(split))
    }
  }
  return [...unknown].sort((a, b) => a - b)
}

/** Listed primary positions for the players that needed a lookup. */
function profilePositions(profiles: unknown, needed: number[]): ReadonlyMap<number, string> {
  if (needed.length === 0) return new Map()
  if (profiles === null) throw new IngestError('profiles', 'no lookup was made')
  const people = Fields.of('profiles', 'response', profiles).list('people')
  if (people.length === 0) throw new IngestError('profiles', 'returned no players')
  const positions = new Map<number, string>()
  for (const person of people) {
    const listed = person.optionalChild('primaryPosition')?.optionalText('abbreviation') ?? null
    const id = person.count('id')
    if (listed !== null) positions.set(id, listed)
  }
  return positions
}

function positionOf(split: Fields, profiles: ReadonlyMap<number, string>): string {
  return reportedPosition(split) ?? profiles.get(mlbIdOf(split)) ?? UNKNOWN_POSITION
}

function identityOf(split: Fields, season: number, profiles: ReadonlyMap<number, string>) {
  return {
    mlbId: mlbIdOf(split),
    name: split.child('player').text('fullName'),
    season,
    team: split.child('team').text('name'),
    numTeams: split.count('numTeams'),
    position: positionOf(split, profiles),
  }
}

function hitterRow(
  split: Fields,
  season: number,
  profiles: ReadonlyMap<number, string>,
  sprint: ReadonlyMap<number, SprintRecord>,
): MlbHitterRow {
  const stat = split.child('stat')
  const identity = identityOf(split, season, profiles)
  return {
    role: 'hitter',
    ...identity,
    plateAppearances: stat.count('plateAppearances'),
    atBats: stat.count('atBats'),
    hits: stat.count('hits'),
    doubles: stat.count('doubles'),
    triples: stat.count('triples'),
    homeRuns: stat.count('homeRuns'),
    strikeOuts: stat.count('strikeOuts'),
    baseOnBalls: stat.count('baseOnBalls'),
    stolenBases: stat.count('stolenBases'),
    caughtStealing: stat.count('caughtStealing'),
    ...sprint.get(identity.mlbId),
  }
}

function pitcherRow(
  split: Fields,
  season: number,
  profiles: ReadonlyMap<number, string>,
  breakdown: Fields,
): MlbPitcherRow {
  const stat = split.child('stat')
  const batted = breakdown.child('stat')
  return {
    role: 'pitcher',
    ...identityOf(split, season, profiles),
    battersFaced: stat.count('battersFaced'),
    outs: stat.count('outs'),
    strikeOuts: stat.count('strikeOuts'),
    baseOnBalls: stat.count('baseOnBalls'),
    homeRuns: stat.count('homeRuns'),
    groundHits: batted.count('groundHits'),
    groundOuts: batted.count('groundOuts'),
    ballsInPlay: batted.count('ballsInPlay'),
  }
}

/**
 * Every hitting and pitching row of a season. Anything a source got wrong or
 * left out throws an {@link IngestError}; nothing is defaulted past.
 */
export function buildSeasonRows(sources: SeasonSources): {
  hitters: MlbHitterRow[]
  pitchers: MlbPitcherRow[]
} {
  const { season } = sources
  const profiles = profilePositions(
    sources.profiles,
    unknownPositionIds(sources.hitting, sources.pitching),
  )
  const sprint = parseSprintSpeeds(sources.sprintCsv)
  const breakdowns = byMlbId('pitching-advanced', sources.pitchingAdvanced)

  const hitters = [...byMlbId('hitting', sources.hitting).values()].map((split) =>
    hitterRow(split, season, profiles, sprint),
  )
  const pitchers = [...byMlbId('pitching', sources.pitching).entries()].map(([id, split]) => {
    const breakdown = breakdowns.get(id)
    if (!breakdown) throw new IngestError('pitching-advanced', `no record for player ${id}`)
    return pitcherRow(split, season, profiles, breakdown)
  })
  return { hitters, pitchers }
}
