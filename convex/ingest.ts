import { v } from 'convex/values'
import { internalAction, internalMutation } from './_generated/server'
import { mlbHitterRow, mlbPitcherRow } from './validators'

/**
 * MLB season ingest (SAN-25, ADR-0037). Red checkpoint: the seam the tests are
 * written against, with no behavior behind it yet.
 */

export interface IngestReport {
  season: number
  hitters: number
  pitchers: number
}

/** Fetch every source for a season, validate it all, then replace the season's rows. */
export const run = internalAction({
  args: { season: v.optional(v.float64()) },
  handler: async (): Promise<IngestReport> => {
    throw new Error('ingest.run is not implemented')
  },
})

/** Replace one season's raw rows in a single transaction. */
export const replaceSeason = internalMutation({
  args: {
    season: v.float64(),
    hitters: v.array(mlbHitterRow),
    pitchers: v.array(mlbPitcherRow),
  },
  handler: async (): Promise<null> => {
    throw new Error('ingest.replaceSeason is not implemented')
  },
})
