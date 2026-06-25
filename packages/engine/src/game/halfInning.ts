import { type GameContext, Half, type TeamLineup } from './state'

/**
 * Who is on offense vs. defense for a given half-inning. The home team bats in
 * the bottom half and the away team in the top (the away team always leads off a
 * game). Resolving this perspective once — instead of re-deriving "which team,
 * which side" at every score / pointer / seating step — keeps the transition
 * logic readable and keeps this baseball rule in a single place.
 */
export interface HalfInning {
  /** True in the bottom half: the home team is batting. */
  readonly battingIsHome: boolean
  /** The lineup currently at bat. */
  readonly battingTeam: TeamLineup
  /** The lineup currently in the field (its pitcher is on the mound). */
  readonly fieldingTeam: TeamLineup
}

/** Resolve the offense/defense perspective for `half` from both lineups. */
export function halfInning(half: Half, context: GameContext): HalfInning {
  const battingIsHome = half === Half.Bottom
  return {
    battingIsHome,
    battingTeam: battingIsHome ? context.home : context.away,
    fieldingTeam: battingIsHome ? context.away : context.home,
  }
}
