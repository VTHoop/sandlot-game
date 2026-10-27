import { v } from 'convex/values'
import { internalMutation, type MutationCtx } from './_generated/server'
import {
  histogramsOf,
  type PlannedPlayer,
  planSeason,
  type ScoreHistograms,
  type SkippedPlayer,
} from './seasonPlayers'

/**
 * Stat → attribute normalization over a stored season (SAN-26): turns the raw
 * `mlbSeasonStats` rows SAN-25 ingested into `players`. Internal on purpose — a
 * developer command (`pnpm normalize:mlb`) runs it; no client does.
 *
 * A player is keyed by MLB id + role. A re-run updates name, position and
 * attributes on the existing row in place (price and everything else stay), and
 * creates rows only for new players; players the season no longer lists are not
 * touched.
 */

export interface NormalizeReport {
  season: number
  created: number
  updated: number
  skipped: SkippedPlayer[]
  scores: ScoreHistograms
}

/** Write one planned player; returns whether it made a new row or updated the existing one. */
async function upsert(ctx: MutationCtx, player: PlannedPlayer): Promise<'created' | 'updated'> {
  const existing = await ctx.db
    .query('players')
    .withIndex('by_mlb_id', (q) => q.eq('mlbId', player.mlbId).eq('role', player.role))
    .unique()
  if (existing) {
    const { name, position, attributes } = player
    await ctx.db.patch(existing._id, { name, position, attributes })
    return 'updated'
  }
  await ctx.db.insert('players', { ...player, source: 'mlb', price: null })
  return 'created'
}

export const run = internalMutation({
  args: { season: v.float64() },
  handler: async (ctx, { season }): Promise<NormalizeReport> => {
    const rows = await ctx.db
      .query('mlbSeasonStats')
      .withIndex('by_season', (q) => q.eq('season', season))
      .collect()
    if (rows.length === 0) {
      throw new Error(
        `No raw MLB rows for season ${season}; run \`pnpm ingest:mlb --season ${season}\` first`,
      )
    }

    const { players, skipped } = planSeason(
      rows.flatMap((row) => (row.role === 'hitter' ? [row] : [])),
      rows.flatMap((row) => (row.role === 'pitcher' ? [row] : [])),
    )
    let created = 0
    for (const player of players) {
      if ((await upsert(ctx, player)) === 'created') created += 1
    }
    return {
      season,
      created,
      updated: players.length - created,
      skipped,
      scores: histogramsOf(players),
    }
  },
})
