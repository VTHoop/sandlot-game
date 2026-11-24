import type { Doc } from './_generated/dataModel'
import { query } from './_generated/server'

export function eligibleMlbTeams(_players: readonly Doc<'players'>[]): string[] {
  return []
}

export const listMlbTeams = query({
  args: {},
  handler: async (): Promise<{ name: string }[]> => [],
})
