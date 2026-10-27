/**
 * Reading the MLB sources' records field by field (SAN-25, ADR-0037). Every read
 * refuses what is missing or malformed with an error that names the source, so
 * a half-formed record aborts the run instead of becoming a half-formed row.
 */

/** Every source the ingest reads; an abort names the one that failed. */
export enum IngestSource {
  Seasons = 'seasons',
  Hitting = 'hitting',
  Pitching = 'pitching',
  PitchingAdvanced = 'pitching-advanced',
  Profiles = 'profiles',
  SprintSpeed = 'sprint-speed',
}

/** The run aborted: a source failed, came back empty, or lacked a required field. */
export class IngestError extends Error {
  constructor(source: IngestSource, detail: string) {
    super(`Ingest aborted: ${source}: ${detail}`)
    this.name = 'IngestError'
  }
}

/** The source fields the ingest reads, named once so no read is a quoted string. */
export enum Field {
  Abbreviation = 'abbreviation',
  AtBats = 'atBats',
  BallsInPlay = 'ballsInPlay',
  BaseOnBalls = 'baseOnBalls',
  BattersFaced = 'battersFaced',
  CaughtStealing = 'caughtStealing',
  Doubles = 'doubles',
  FullName = 'fullName',
  GroundHits = 'groundHits',
  GroundOuts = 'groundOuts',
  Hits = 'hits',
  HomeRuns = 'homeRuns',
  Id = 'id',
  Name = 'name',
  NumTeams = 'numTeams',
  Outs = 'outs',
  People = 'people',
  PlateAppearances = 'plateAppearances',
  Player = 'player',
  Position = 'position',
  PrimaryPosition = 'primaryPosition',
  RegularSeasonEndDate = 'regularSeasonEndDate',
  SeasonId = 'seasonId',
  Seasons = 'seasons',
  Splits = 'splits',
  Stat = 'stat',
  Stats = 'stats',
  StolenBases = 'stolenBases',
  StrikeOuts = 'strikeOuts',
  Team = 'team',
  Triples = 'triples',
}

const isRecord = (value: unknown): value is object =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * One JSON object from a source, read by field name through a `Map` so no read
 * is a computed member access (AGENTS.md → Code conventions).
 */
export class Fields {
  private constructor(
    private readonly source: IngestSource,
    private readonly what: string,
    private readonly values: ReadonlyMap<string, unknown>,
  ) {}

  static of(source: IngestSource, what: string, value: unknown): Fields {
    if (!isRecord(value)) {
      throw new IngestError(source, `${what} is not an object`)
    }
    return new Fields(source, what, new Map(Object.entries(value)))
  }

  private lacks(key: Field): never {
    throw new IngestError(this.source, `${this.what} lacks ${key}`)
  }

  /** A non-negative number: a count, an id. */
  count(key: Field): number {
    const value = this.values.get(key)
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) this.lacks(key)
    return value
  }

  text(key: Field): string {
    const value = this.values.get(key)
    if (typeof value !== 'string' || value === '') this.lacks(key)
    return value
  }

  /** Text that may be absent; present but empty or not text is still refused. */
  optionalText(key: Field): string | null {
    return this.values.has(key) ? this.text(key) : null
  }

  child(key: Field): Fields {
    const value = this.values.get(key)
    if (value === undefined) this.lacks(key)
    return Fields.of(this.source, `${this.what}.${key}`, value)
  }

  /** A child object that may be absent. */
  optionalChild(key: Field): Fields | null {
    return this.values.has(key) ? this.child(key) : null
  }

  list(key: Field): Fields[] {
    const value = this.values.get(key)
    if (!Array.isArray(value)) this.lacks(key)
    return value.map((item, i) => Fields.of(this.source, `${this.what}.${key}[${i}]`, item))
  }
}
