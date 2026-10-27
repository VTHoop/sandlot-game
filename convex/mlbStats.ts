import type { Infer } from 'convex/values'
import { Field, Fields, IngestError, IngestSource } from './mlbFields'
import { parseSprintSpeeds, type SprintRecord } from './sprintSpeed'
import type { mlbHitterRow, mlbPitcherRow } from './validators'

/**
 * MLB season ingest, the pure half (SAN-25, ADR-0037): turns what the sources
 * returned into raw stat rows, and refuses anything incomplete. No I/O here —
 * `convex/ingest.ts` fetches, this reads.
 */

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

/** A season record's year; an id that is not a year would become `year=NaN` in every request. */
function yearOf(record: Fields): number {
  const id = record.text(Field.SeasonId)
  const year = Number(id)
  if (!Number.isInteger(year)) {
    throw new IngestError(IngestSource.Seasons, `season id ${id} is not a year`)
  }
  return year
}

/** The most recent season whose regular season ended before `today` (UTC). */
export function latestCompletedSeason(seasons: unknown, today: Date): number {
  const records = Fields.of(IngestSource.Seasons, 'response', seasons).list(Field.Seasons)
  if (records.length === 0) throw new IngestError(IngestSource.Seasons, 'returned no seasons')
  const ended = records
    .map((record) => ({
      year: yearOf(record),
      lastGame: record.text(Field.RegularSeasonEndDate),
    }))
    .filter(({ lastGame }) => lastGame < dayOf(today))
  if (ended.length === 0) {
    throw new IngestError(IngestSource.Seasons, 'no regular season has ended yet')
  }
  return Math.max(...ended.map(({ year }) => year))
}

/** The players of one stats response, as the API lists them. */
function splitsOf(source: IngestSource, response: unknown): Fields[] {
  const group = Fields.of(source, 'response', response).list(Field.Stats).shift()
  const splits = group?.list(Field.Splits) ?? []
  if (splits.length === 0) throw new IngestError(source, 'returned no players')
  return splits
}

const mlbIdOf = (split: Fields): number => split.child(Field.Player).count(Field.Id)

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
  const abbreviation = split.optionalChild(Field.Position)?.text(Field.Abbreviation) ?? null
  return abbreviation === UNREPORTED_POSITION ? null : abbreviation
}

/** MLB ids whose position the stats do not report, across both groups, ascending. */
export function unknownPositionIds(hitting: unknown, pitching: unknown): number[] {
  const unknown = new Set<number>()
  for (const [source, response] of [
    [IngestSource.Hitting, hitting],
    [IngestSource.Pitching, pitching],
  ] as const) {
    for (const split of splitsOf(source, response)) {
      if (reportedPosition(split) === null) unknown.add(mlbIdOf(split))
    }
  }
  return [...unknown].sort((a, b) => a - b)
}

/** The primary position each profile lists; a profile that lists none is left out. */
function listedPositions(people: Fields[]): Map<number, string> {
  const positions = new Map<number, string>()
  for (const person of people) {
    const listed =
      person.optionalChild(Field.PrimaryPosition)?.optionalText(Field.Abbreviation) ?? null
    const id = person.count(Field.Id)
    if (listed !== null) positions.set(id, listed)
  }
  return positions
}

/** Listed primary positions for the players that needed a lookup. */
function profilePositions(profiles: unknown, needed: number[]): ReadonlyMap<number, string> {
  if (needed.length === 0) return new Map()
  if (profiles === null) throw new IngestError(IngestSource.Profiles, 'no lookup was made')
  const people = Fields.of(IngestSource.Profiles, 'response', profiles).list(Field.People)
  if (people.length === 0) throw new IngestError(IngestSource.Profiles, 'returned no players')
  return listedPositions(people)
}

function positionOf(split: Fields, profiles: ReadonlyMap<number, string>): string {
  return reportedPosition(split) ?? profiles.get(mlbIdOf(split)) ?? UNKNOWN_POSITION
}

function identityOf(split: Fields, season: number, profiles: ReadonlyMap<number, string>) {
  return {
    mlbId: mlbIdOf(split),
    name: split.child(Field.Player).text(Field.FullName),
    season,
    team: split.child(Field.Team).text(Field.Name),
    numTeams: split.count(Field.NumTeams),
    position: positionOf(split, profiles),
  }
}

function hitterRow(
  split: Fields,
  season: number,
  profiles: ReadonlyMap<number, string>,
  sprint: ReadonlyMap<number, SprintRecord>,
): MlbHitterRow {
  const stat = split.child(Field.Stat)
  const identity = identityOf(split, season, profiles)
  return {
    role: 'hitter',
    ...identity,
    plateAppearances: stat.count(Field.PlateAppearances),
    atBats: stat.count(Field.AtBats),
    hits: stat.count(Field.Hits),
    doubles: stat.count(Field.Doubles),
    triples: stat.count(Field.Triples),
    homeRuns: stat.count(Field.HomeRuns),
    strikeOuts: stat.count(Field.StrikeOuts),
    baseOnBalls: stat.count(Field.BaseOnBalls),
    stolenBases: stat.count(Field.StolenBases),
    caughtStealing: stat.count(Field.CaughtStealing),
    ...sprint.get(identity.mlbId),
  }
}

function pitcherRow(
  split: Fields,
  season: number,
  profiles: ReadonlyMap<number, string>,
  breakdown: Fields,
): MlbPitcherRow {
  const stat = split.child(Field.Stat)
  const batted = breakdown.child(Field.Stat)
  return {
    role: 'pitcher',
    ...identityOf(split, season, profiles),
    battersFaced: stat.count(Field.BattersFaced),
    outs: stat.count(Field.Outs),
    strikeOuts: stat.count(Field.StrikeOuts),
    baseOnBalls: stat.count(Field.BaseOnBalls),
    homeRuns: stat.count(Field.HomeRuns),
    groundHits: batted.count(Field.GroundHits),
    groundOuts: batted.count(Field.GroundOuts),
    ballsInPlay: batted.count(Field.BallsInPlay),
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
  const breakdowns = byMlbId(IngestSource.PitchingAdvanced, sources.pitchingAdvanced)

  const hitters = [...byMlbId(IngestSource.Hitting, sources.hitting).values()].map((split) =>
    hitterRow(split, season, profiles, sprint),
  )
  const pitchers = [...byMlbId(IngestSource.Pitching, sources.pitching).entries()].map(
    ([id, split]) => {
      const breakdown = breakdowns.get(id)
      if (!breakdown)
        throw new IngestError(IngestSource.PitchingAdvanced, `no record for player ${id}`)
      return pitcherRow(split, season, profiles, breakdown)
    },
  )
  return { hitters, pitchers }
}
