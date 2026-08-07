import type { Id } from './_generated/dataModel'
import { mutation } from './_generated/server'

/** RED checkpoint (SAN-55): the spec lives in `users.test.ts`; this is the stub it grades. */
export const provision = mutation({
  args: {},
  handler: (): Promise<Id<'users'>> => {
    throw new Error('not implemented')
  },
})
