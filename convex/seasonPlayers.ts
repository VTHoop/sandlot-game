import type { Infer } from 'convex/values'
import {
  type HitterAttributes,
  hitterAttributes,
  type LeagueRates,
  leagueRates,
  type PitcherAttributes,
  pitcherAttributes,
  type Score,
} from './attributes'
import type { MlbHitterRow, MlbPitcherRow } from './mlbStats'
import type { position } from './validators'

/**
 * A season's raw rows → the players they become, and the players they cannot
 * (SAN-26). Pure: `convex/normalize.ts` reads the rows and writes the result.
 *
 * Role follows the position the API reported on that row: `P` is a pitcher, any
 * other position a hitter, and the other-role row a player also has is ignored.
 * A two-way player (`TWP`) is both, hitting at DH. Nothing is guessed — an
 * unknown position, or one the engine has no lineup slot for, is skipped by name.
 */

export type Position = Infer<typeof position>

export interface SkippedPlayer {
  mlbId: number
  name: string
  reason: string
}

export type ScoreCounts = readonly [number, number, number, number, number]

export interface ScoreHistograms {
  power: ScoreCounts
  contact: ScoreCounts
  speed: ScoreCounts
  eye: ScoreCounts
  velocity: ScoreCounts
  movement: ScoreCounts
  awareness: ScoreCounts
  command: ScoreCounts
}

interface PlannedHitter {
  mlbId: number
  name: string
  role: 'hitter'
  position: Position
  attributes: HitterAttributes
}

interface PlannedPitcher {
  mlbId: number
  name: string
  role: 'pitcher'
  position: Position
  attributes: PitcherAttributes
}

export type PlannedPlayer = PlannedHitter | PlannedPitcher

export interface SeasonPlan {
  players: PlannedPlayer[]
  skipped: SkippedPlayer[]
}

/** What one raw row comes to: a player, a named skip, or nothing (the other role's row). */
type Outcome<P> = { player: P } | { skip: string } | null

/** The API's marks for "no position reported" and "plays both ways". */
const UNKNOWN = 'unknown'
const TWO_WAY = 'TWP'
const PITCHER = 'P'

/** The lineup slots a hitter can take: every engine position but P. */
const HITTER_SLOTS: ReadonlyMap<string, Position> = new Map(
  (['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'DH'] as const).map((slot) => [slot, slot]),
)

function hitterPosition(reported: string): { position: Position } | { skip: string } | null {
  if (reported === PITCHER) return null
  if (reported === TWO_WAY) return { position: 'DH' }
  if (reported === UNKNOWN) return { skip: 'position unknown' }
  const slot = HITTER_SLOTS.get(reported)
  return slot ? { position: slot } : { skip: `position ${reported} has no lineup slot` }
}

function planHitter(row: MlbHitterRow, league: LeagueRates): Outcome<PlannedHitter> {
  const placed = hitterPosition(row.position)
  if (placed === null || 'skip' in placed) return placed
  const { mlbId, name } = row
  return {
    player: {
      mlbId,
      name,
      role: 'hitter',
      position: placed.position,
      attributes: hitterAttributes(row, league),
    },
  }
}

function planPitcher(row: MlbPitcherRow, league: LeagueRates): Outcome<PlannedPitcher> {
  if (row.position === UNKNOWN) return { skip: 'position unknown' }
  if (row.position !== PITCHER && row.position !== TWO_WAY) return null
  if (row.outs <= 0) return { skip: 'no outs recorded, so HR/9 is undefined' }
  const { mlbId, name } = row
  return {
    player: {
      mlbId,
      name,
      role: 'pitcher',
      position: PITCHER,
      attributes: pitcherAttributes(row, league),
    },
  }
}

/**
 * Every raw row of the season, scored against league rates pooled over all of
 * them — the rows it skips included. A player skipped on both rows is named once.
 */
export function planSeason(
  hitters: readonly MlbHitterRow[],
  pitchers: readonly MlbPitcherRow[],
): SeasonPlan {
  const league = leagueRates(hitters, pitchers)
  const outcomes: { row: MlbHitterRow | MlbPitcherRow; outcome: Outcome<PlannedPlayer> }[] = [
    ...hitters.map((row) => ({ row, outcome: planHitter(row, league) })),
    ...pitchers.map((row) => ({ row, outcome: planPitcher(row, league) })),
  ]

  const players: PlannedPlayer[] = []
  const skipped = new Map<number, SkippedPlayer>()
  for (const { row, outcome } of outcomes) {
    if (outcome === null) continue
    if ('player' in outcome) players.push(outcome.player)
    else if (!skipped.has(row.mlbId)) {
      skipped.set(row.mlbId, { mlbId: row.mlbId, name: row.name, reason: outcome.skip })
    }
  }
  return { players, skipped: [...skipped.values()] }
}

function tally(scores: readonly Score[]): ScoreCounts {
  const count = (score: Score) => scores.filter((s) => s === score).length
  return [count(1), count(2), count(3), count(4), count(5)]
}

const isHitter = (player: PlannedPlayer): player is PlannedHitter => player.role === 'hitter'
const isPitcher = (player: PlannedPlayer): player is PlannedPitcher => player.role === 'pitcher'

/** How many planned players scored each 1–5 on each attribute. */
export function histogramsOf(players: readonly PlannedPlayer[]): ScoreHistograms {
  const hitters = players.filter(isHitter).map((player) => player.attributes)
  const pitchers = players.filter(isPitcher).map((player) => player.attributes)
  return {
    power: tally(hitters.map((a) => a.power)),
    contact: tally(hitters.map((a) => a.contact)),
    speed: tally(hitters.map((a) => a.speed)),
    eye: tally(hitters.map((a) => a.eye)),
    velocity: tally(pitchers.map((a) => a.velocity)),
    movement: tally(pitchers.map((a) => a.movement)),
    awareness: tally(pitchers.map((a) => a.awareness)),
    command: tally(pitchers.map((a) => a.command)),
  }
}
