import { v } from 'convex/values'
import { internalMutation } from './_generated/server'
import type { ScoreHistograms, SkippedPlayer } from './seasonPlayers'

/**
 * Stat → attribute normalization over a stored season (SAN-26): turns the raw
 * `mlbSeasonStats` rows SAN-25 ingested into `players`. Internal on purpose — a
 * developer command (`pnpm normalize:mlb`) runs it; no client does.
 */

export interface NormalizeReport {
  season: number
  created: number
  updated: number
  skipped: SkippedPlayer[]
  scores: ScoreHistograms
}

export const run = internalMutation({
  args: { season: v.float64() },
  handler: async (_ctx, _args): Promise<NormalizeReport> => {
    throw new Error('not implemented')
  },
})
