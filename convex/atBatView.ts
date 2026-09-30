import { v } from 'convex/values'
import { query } from './_generated/server'
import type { ResolvedAtBatView } from './duelContract'

/**
 * The resolved at-bat read model (SAN-39). Declared and stubbed: the red
 * checkpoint has to compile, and the behaviour lands in the green commit.
 */
export const getLastAtBat = query({
  args: { game: v.id('games') },
  handler: async (): Promise<ResolvedAtBatView | null> => null,
})
