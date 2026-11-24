import type { Doc, Id } from './_generated/dataModel'
import { eligibleMlbTeams } from './mlbTeams'
import { HITTER_SLOT_LIST } from './seasonPlayers'

/**
 * The lineup builder (SAN-78): a real MLB team's players → nine batters in their
 * positions plus a starting pitcher, in the `lineups` table's shape. Pure, so
 * autodraft (SAN-33) and the bot can reuse it.
 *
 * Regulars are picked by playing time — most plate appearances at each position,
 * most outs for the starter — and every tie falls to the player `_id`, so the same
 * players always make the same lineup whatever order they arrive in. A player with
 * no recorded playing time is refused rather than ranked as if they had none: the
 * season was normalized before `plateAppearances` / `outs` existed (ADR-0043).
 */

export interface BuiltLineup {
  battingOrder: { player: Id<'players'>; position: Doc<'players'>['position'] }[]
  pitcher: Id<'players'>
}

type Player = Doc<'players'>

/** Both of the lineup's tie-breaks: most playing time first, then the lower `_id`. */
function byPlayingTime(time: (player: Player) => number) {
  return (a: Player, b: Player): number => time(b) - time(a) || compareIds(a._id, b._id)
}

function compareIds(a: string, b: string): number {
  if (a === b) return 0
  return a < b ? -1 : 1
}

function plateAppearances(player: Player): number {
  return playingTime(player, player.plateAppearances)
}

function outs(player: Player): number {
  return playingTime(player, player.outs)
}

function playingTime(player: Player, recorded: number | undefined): number {
  if (recorded === undefined) {
    throw new Error(
      `Player "${player.name}" has no recorded playing time; run \`pnpm normalize:mlb\` again`,
    )
  }
  return recorded
}

/**
 * The regular among these players: the one who sorts first by playing time.
 * `sort` never calls its comparator on a lone candidate, so the pick's own playing
 * time is read explicitly — a lone player with none is refused like any other.
 */
function regular(candidates: readonly Player[], time: (player: Player) => number): Player {
  const [first] = [...candidates].sort(byPlayingTime(time))
  if (!first) throw new Error('No player to pick from')
  time(first)
  return first
}

/** The sum of a hitter's four ratings. */
function ratingSum(player: Player): number {
  const { attributes } = player
  if (!('power' in attributes)) {
    throw new Error(`Hitter "${player.name}" carries pitcher attributes`)
  }
  return attributes.power + attributes.contact + attributes.speed + attributes.eye
}

/** Highest rating sum first; a tie goes to more plate appearances, then the lower `_id`. */
function battingOrderOf(hitters: readonly Player[]): Player[] {
  return [...hitters].sort(
    (a, b) => ratingSum(b) - ratingSum(a) || byPlayingTime(plateAppearances)(a, b),
  )
}

/** Build the lineup for the named team; throws for a team `listMlbTeams` would not offer. */
export function buildLineup(team: string, players: readonly Player[]): BuiltLineup {
  if (!eligibleMlbTeams(players).includes(team)) {
    throw new Error(`Team "${team}" is not offered: it cannot field a lineup`)
  }
  const roster = players.filter((p) => p.source === 'mlb' && p.mlbTeam === team)
  const hitters = roster.filter((p) => p.role === 'hitter')
  const starters = HITTER_SLOT_LIST.map((slot) =>
    regular(
      hitters.filter((p) => p.position === slot),
      plateAppearances,
    ),
  )
  return {
    battingOrder: battingOrderOf(starters).map((p) => ({ player: p._id, position: p.position })),
    pitcher: regular(
      roster.filter((p) => p.role === 'pitcher'),
      outs,
    )._id,
  }
}
