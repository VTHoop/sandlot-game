import { describe, expect, it } from 'vitest'
import {
  buildSeasonRows,
  IngestError,
  latestCompletedSeason,
  type SeasonSources,
  UNKNOWN_POSITION,
  unknownPositionIds,
} from './mlbStats'

/**
 * The pure half of the MLB ingest (SAN-25): what the sources said, in the shape
 * the real APIs use, becomes raw stat rows — or a refusal naming the source.
 * Every name and number here is invented; none is a captured response.
 */

const season = (seasonId: string, regularSeasonEndDate: string) => ({
  seasonId,
  regularSeasonEndDate,
})

const SEASONS = {
  seasons: [
    season('2024', '2024-09-29'),
    season('2025', '2025-09-28'),
    season('2026', '2026-09-27'),
    season('2027', '2027-09-26'),
  ],
}

interface SplitInput {
  id: number
  name?: string
  position?: string
  team?: string
  numTeams?: number
  stat: Record<string, number>
}

/** One entry of a `stats[0].splits` array, in the Stats API's shape. */
function split({
  id,
  name = `Player ${id}`,
  position,
  team = 'Harbor Gulls',
  numTeams = 1,
  stat,
}: SplitInput) {
  return {
    season: '2026',
    stat,
    team: { id: 1, name: team },
    player: { id, fullName: name },
    numTeams,
    ...(position === undefined ? {} : { position: { abbreviation: position } }),
  }
}

const statsResponse = (...splits: unknown[]) => ({
  stats: [{ totalSplits: splits.length, splits }],
})

const HITTER_STAT = {
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
}
const PITCHER_STAT = {
  battersFaced: 700,
  outs: 540,
  strikeOuts: 180,
  baseOnBalls: 55,
  homeRuns: 20,
}
const ADVANCED_STAT = { groundHits: 90, groundOuts: 210, ballsInPlay: 480 }

const SPRINT_CSV =
  '﻿"last_name, first_name","player_id","team_id","team","position","age","competitive_runs","bolts","hp_to_1b","sprint_speed"\n' +
  '"Quill, Ada",900001,1,"HG","SS",27,"120","60","4.10","28.4"\n'

function sources(over: Partial<SeasonSources> = {}): SeasonSources {
  return {
    season: 2026,
    hitting: statsResponse(
      split({ id: 900001, name: 'Ada Quill', position: 'SS', stat: HITTER_STAT }),
    ),
    pitching: statsResponse(
      split({ id: 900007, name: 'Gus Hale', position: 'P', stat: PITCHER_STAT }),
    ),
    pitchingAdvanced: statsResponse(split({ id: 900007, position: 'P', stat: ADVANCED_STAT })),
    profiles: null,
    sprintCsv: SPRINT_CSV,
    ...over,
  }
}

describe('latestCompletedSeason', () => {
  it('is the latest season whose regular season has ended', () => {
    expect(latestCompletedSeason(SEASONS, new Date('2026-10-26T12:00:00Z'))).toBe(2026)
  })

  it('skips a season still in progress', () => {
    expect(latestCompletedSeason(SEASONS, new Date('2026-06-01T12:00:00Z'))).toBe(2025)
  })

  it('does not count the season until the day after its last regular-season game', () => {
    expect(latestCompletedSeason(SEASONS, new Date('2026-09-27T23:00:00Z'))).toBe(2025)
    expect(latestCompletedSeason(SEASONS, new Date('2026-09-28T00:30:00Z'))).toBe(2026)
  })

  it('refuses when no season has ended', () => {
    expect(() => latestCompletedSeason(SEASONS, new Date('2023-01-01T00:00:00Z'))).toThrow(
      'seasons:',
    )
  })

  it('refuses a season that lacks its regular-season end date', () => {
    const broken = { seasons: [{ seasonId: '2026' }] }
    expect(() => latestCompletedSeason(broken, new Date('2026-10-26T00:00:00Z'))).toThrow(
      'seasons:',
    )
  })
})

describe('unknownPositionIds', () => {
  it('lists each player reported as X or with no position, once, across both groups', () => {
    const hitting = statsResponse(
      split({ id: 3, position: 'X', stat: HITTER_STAT }),
      split({ id: 1, position: 'X', stat: HITTER_STAT }),
      split({ id: 2, position: 'SS', stat: HITTER_STAT }),
    )
    const pitching = statsResponse(
      split({ id: 1, position: 'X', stat: PITCHER_STAT }),
      split({ id: 4, stat: PITCHER_STAT }),
    )
    expect(unknownPositionIds(hitting, pitching)).toEqual([1, 3, 4])
  })

  it('is empty when every position is known', () => {
    expect(unknownPositionIds(sources().hitting, sources().pitching)).toEqual([])
  })
})

describe('buildSeasonRows', () => {
  it('maps a hitter and a pitcher onto their rows, GB inputs from the advanced group', () => {
    const { hitters, pitchers } = buildSeasonRows(sources())
    expect(hitters).toEqual([
      {
        role: 'hitter',
        mlbId: 900001,
        name: 'Ada Quill',
        season: 2026,
        team: 'Harbor Gulls',
        numTeams: 1,
        position: 'SS',
        ...HITTER_STAT,
        sprintSpeed: 28.4,
        competitiveRuns: 120,
      },
    ])
    expect(pitchers).toEqual([
      {
        role: 'pitcher',
        mlbId: 900007,
        name: 'Gus Hale',
        season: 2026,
        team: 'Harbor Gulls',
        numTeams: 1,
        position: 'P',
        ...PITCHER_STAT,
        ...ADVANCED_STAT,
      },
    ])
  })

  it('reads the Savant CSV through its BOM and quoted fields, joining on player_id', () => {
    const { hitters } = buildSeasonRows(sources())
    expect(hitters.map((h) => h.sprintSpeed)).toEqual([28.4])
  })

  it('leaves sprint speed and runs off a hitter the leaderboard does not list', () => {
    const lonely = statsResponse(split({ id: 900099, position: 'CF', stat: HITTER_STAT }))
    const [row] = buildSeasonRows(sources({ hitting: lonely })).hitters
    expect(row).not.toHaveProperty('sprintSpeed')
    expect(row).not.toHaveProperty('competitiveRuns')
  })

  it('takes an X position from the profile, and stores unknown when the profile names none', () => {
    const hitting = statsResponse(
      split({ id: 1, position: 'X', stat: HITTER_STAT }),
      split({ id: 2, position: 'X', stat: HITTER_STAT }),
    )
    const profiles = {
      people: [{ id: 1, primaryPosition: { abbreviation: 'DH' } }, { id: 2 }],
    }
    const { hitters } = buildSeasonRows(sources({ hitting, profiles }))
    expect(hitters.map((h) => h.position)).toEqual(['DH', UNKNOWN_POSITION])
  })

  it('refuses a pitcher the advanced group does not list', () => {
    const advanced = statsResponse(split({ id: 424242, position: 'P', stat: ADVANCED_STAT }))
    expect(() => buildSeasonRows(sources({ pitchingAdvanced: advanced }))).toThrow(
      'pitching-advanced:',
    )
  })

  it('refuses a player listed twice in one group, rather than store two rows', () => {
    const twice = statsResponse(
      split({ id: 1, position: 'SS', stat: HITTER_STAT }),
      split({ id: 1, position: 'SS', stat: HITTER_STAT }),
    )
    const build = () => buildSeasonRows(sources({ hitting: twice }))
    expect(build).toThrow(IngestError)
    expect(build).toThrow('hitting:')
  })

  it('refuses a Savant file with no sprint_speed column', () => {
    const csv = '"player_id","competitive_runs"\n900001,"120"\n'
    expect(() => buildSeasonRows(sources({ sprintCsv: csv }))).toThrow('sprint-speed:')
  })
})
