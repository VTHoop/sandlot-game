import type { Doc, Id } from './_generated/dataModel'

/**
 * The lineup builder (SAN-78): a real MLB team's players → nine batters in their
 * positions plus a starting pitcher, in the `lineups` table's shape. Pure, so
 * autodraft (SAN-33) and the bot can reuse it.
 */

export interface BuiltLineup {
  battingOrder: { player: Id<'players'>; position: Doc<'players'>['position'] }[]
  pitcher: Id<'players'>
}

/** Build the lineup for the named team; throws for a team `listMlbTeams` would not offer. */
export function buildLineup(_team: string, _players: readonly Doc<'players'>[]): BuiltLineup {
  throw new Error('not implemented')
}
