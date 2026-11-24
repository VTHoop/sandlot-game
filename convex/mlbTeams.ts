import type { Doc } from './_generated/dataModel'
import { query } from './_generated/server'
import { maybeUser } from './participants'

/**
 * The real MLB teams a player can pick (SAN-77). A team is offered only when its
 * `source: 'mlb'` players can field a lineup: a hitter at every slot (C through RF,
 * and DH) and at least one pitcher. {@link eligibleMlbTeams} is the one statement
 * of that rule — the lineup builder reads the same function rather than restating it.
 *
 * A hitter has one row per MLB id, so a hitter at each position is already nine
 * different players; a two-way player counts through his DH hitter row and his
 * pitcher row. Players with another source, or no team, count toward no team.
 */

const HITTER_SLOTS = ['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'DH'] as const

/** The name of every team whose players can field a lineup, alphabetically. */
export function eligibleMlbTeams(players: readonly Doc<'players'>[]): string[] {
  const slotsByTeam = new Map<string, Set<string>>()
  for (const { source, mlbTeam, role, position } of players) {
    if (source !== 'mlb' || mlbTeam === undefined) continue
    const slots = slotsByTeam.get(mlbTeam) ?? new Set<string>()
    slots.add(role === 'pitcher' ? 'P' : position)
    slotsByTeam.set(mlbTeam, slots)
  }
  return [...slotsByTeam]
    .filter(([, slots]) => slots.has('P') && HITTER_SLOTS.every((slot) => slots.has(slot)))
    .map(([team]) => team)
    .sort((a, b) => a.localeCompare(b))
}

/** The real teams a signed-in user can pick; empty for anyone else. */
export const listMlbTeams = query({
  args: {},
  handler: async (ctx): Promise<{ name: string }[]> => {
    if (!(await maybeUser(ctx))) return []
    const players = await ctx.db
      .query('players')
      .withIndex('by_source', (q) => q.eq('source', 'mlb'))
      .collect()
    return eligibleMlbTeams(players).map((name) => ({ name }))
  },
})
