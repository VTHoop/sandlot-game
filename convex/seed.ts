import type { Id } from './_generated/dataModel'
import { internalMutation } from './_generated/server'

/**
 * Dev-only fixture seed (SAN-54) — skeleton. The behaviour lands next commit;
 * this exists so the red spec in `seed.test.ts` fails on its assertions rather
 * than on a missing module, keeping the commit hooks honest.
 */

/** Opt-in flag; the seed is fail-closed without it. */
export const SEED_ENV_FLAG = 'SANDLOT_DEV_SEED'

/** The synthetic Clerk subject the seed's owner row is keyed on. */
export const SEED_CLERK_SUBJECT = 'seed|sandlot-dev-owner'

export const seedDevGame = internalMutation({
  args: {},
  handler: (): Promise<Id<'games'>> => {
    throw new Error('seedDevGame is not implemented yet')
  },
})
