import type { Doc, Id } from './_generated/dataModel'
import type { MutationCtx } from './_generated/server'

/**
 * Shared by the `*.test.ts` fixtures that predate game managers (SAN-76): the
 * game's managers as its teams' owners are today. What those tests pin is who may
 * act, not how that was decided. Never imported by production code.
 */

function ownerManager(team: Doc<'teams'> | null, id: Id<'teams'>) {
  if (!team) throw new Error(`fixture team ${id} does not exist`)
  if (!team.owner) throw new Error(`fixture team "${team.name}" has no owner`)
  return { kind: 'user' as const, user: team.owner }
}

export async function ownerManagers(
  ctx: MutationCtx,
  homeTeam: Id<'teams'>,
  awayTeam: Id<'teams'>,
) {
  const [home, away] = await Promise.all([ctx.db.get(homeTeam), ctx.db.get(awayTeam)])
  return {
    homeManager: ownerManager(home, homeTeam),
    awayManager: ownerManager(away, awayTeam),
  }
}
