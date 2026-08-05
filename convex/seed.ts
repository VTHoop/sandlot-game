import type { Doc, Id } from './_generated/dataModel'
import { internalMutation, type MutationCtx } from './_generated/server'
import { AWAY_TEAM, HOME_TEAM, type PitcherSpec, type TeamSpec } from './seedRoster'

/**
 * Dev-only fixture seed (SAN-54).
 *
 * `game.startGame` needs a scheduled game with two owned teams and two complete
 * lineups behind it, and nothing in the app creates one yet — the draft, salary
 * cap, and MLB ingest that eventually will are their own projects. This mints
 * that game so local development and manual QA have something to play.
 *
 * It is deliberately a fixture, not the real roster-building flow, so it is
 * fenced twice: it is an `internalMutation` (no browser client can name it in
 * any deployment) **and** it refuses to run unless {@link SEED_ENV_FLAG} is
 * explicitly set to `true` on the deployment. Absence blocks — a fresh
 * deployment is safe before anyone thinks about it.
 *
 * Re-running is a supported, additive operation, not an idempotent one: the
 * owner, both clubs, and their twenty players are created once and reused
 * forever after, while every run appends a *new* scheduled game and its two
 * lineups. Nothing is ever deleted or patched, so earlier games stay playable
 * history.
 *
 * The three reuse lookups below are all read-then-insert *into the range they
 * just read*, which is what makes them safe without a unique constraint (none
 * of these tables has one): two concurrent runs overlap read and write sets, so
 * Convex's serializable OCC conflicts one and retries it, and the retry sees the
 * committed row and reuses it. The same discipline as the duel's ordinal (SAN-20).
 *
 * All names and ratings live in `./seedRoster` and are invented — no MLB data
 * (AGENTS.md / ADR-0006).
 */

/**
 * The opt-in flag, set per deployment (`npx convex env set SANDLOT_DEV_SEED
 * true`). Never set in production.
 */
export const SEED_ENV_FLAG = 'SANDLOT_DEV_SEED'

/**
 * The synthetic Clerk subject the seed's owner row is keyed on. It is not a
 * real Clerk subject and cannot collide with one — the pipe prefix is not a
 * shape Clerk issues — so the upsert can never adopt a real account's row.
 */
export const SEED_CLERK_SUBJECT = 'seed|sandlot-dev-owner'

const SEED_DISPLAY_NAME = 'Sandlot Dev'

/** The pre-start `games` envelope: nothing has happened yet. */
const SCHEDULED_GAME = {
  inning: 1,
  half: 'top',
  outs: 0,
  bases: { first: null, second: null, third: null },
  homeScore: 0,
  awayScore: 0,
  status: 'scheduled',
  currentBatter: null,
  currentPitcher: null,
  homeBattingIndex: 0,
  awayBattingIndex: 0,
  // No at-bat has been folded in yet (schema.ts) — the engine seeds from -1.
  lastResolvedSequence: -1,
} as const

/** Fail closed: anything other than an explicit opt-in refuses to run. */
function assertSeedEnabled(): void {
  if (process.env.SANDLOT_DEV_SEED !== 'true') {
    throw new Error(`Dev seed refused: set ${SEED_ENV_FLAG}=true on this deployment to enable it`)
  }
}

/** The seed's owner, created on the first run and reused on every later one. */
async function seedOwner(ctx: MutationCtx): Promise<Id<'users'>> {
  const existing = await ctx.db
    .query('users')
    .withIndex('by_clerk_subject', (q) => q.eq('clerkSubject', SEED_CLERK_SUBJECT))
    .unique()
  return (
    existing?._id ??
    ctx.db.insert('users', {
      clerkSubject: SEED_CLERK_SUBJECT,
      displayName: SEED_DISPLAY_NAME,
    })
  )
}

/**
 * One club, keyed on its fixed name within the owner's teams. Both clubs share
 * the one owner, so a single identity can act for both sides of a seeded duel.
 */
async function seedTeam(ctx: MutationCtx, owner: Id<'users'>, name: string): Promise<Id<'teams'>> {
  const owned = await ctx.db
    .query('teams')
    .withIndex('by_owner', (q) => q.eq('owner', owner))
    .collect()
  const existing = owned.find((team) => team.name === name)
  return existing?._id ?? ctx.db.insert('teams', { owner, name })
}

/** Seeded players are invented, so they are `custom`, never `mlb`. Price is the
 * salary-cap pipeline's to derive, so it stays null. */
function insertPlayer(
  ctx: MutationCtx,
  fields: Pick<Doc<'players'>, 'name' | 'role' | 'position' | 'attributes'>,
): Promise<Id<'players'>> {
  return ctx.db.insert('players', { ...fields, source: 'custom', price: null })
}

function insertPitcher(ctx: MutationCtx, spec: PitcherSpec): Promise<Id<'players'>> {
  return insertPlayer(ctx, { ...spec, role: 'pitcher', position: 'P' })
}

/** The nine batters, in the spec's array order — which *is* the batting order. */
async function insertBattingOrder(
  ctx: MutationCtx,
  spec: TeamSpec,
): Promise<Doc<'lineups'>['battingOrder']> {
  const slots: Doc<'lineups'>['battingOrder'] = []
  // Sequential on purpose: the insert order fixes the batting order.
  for (const hitter of spec.battingOrder) {
    const player = await insertPlayer(ctx, { ...hitter, role: 'hitter' })
    slots.push({ player, position: hitter.position })
  }
  return slots
}

type Roster = Pick<Doc<'lineups'>, 'battingOrder' | 'pitcher'>

/**
 * The club's standing roster. A player has no team column — the only link from
 * a team to its players is a `lineups` row — so "does this club already have
 * players?" is answered by its earliest lineup, and that lineup's slots are
 * reused verbatim. Every run after the first therefore fields the same twenty
 * players in the same order without touching a single existing row.
 */
async function seedRoster(ctx: MutationCtx, team: Id<'teams'>, spec: TeamSpec): Promise<Roster> {
  const prior = await ctx.db
    .query('lineups')
    .withIndex('by_team', (q) => q.eq('team', team))
    .first()
  if (prior) return { battingOrder: prior.battingOrder, pitcher: prior.pitcher }
  return {
    battingOrder: await insertBattingOrder(ctx, spec),
    pitcher: await insertPitcher(ctx, spec.pitcher),
  }
}

/**
 * Mint a scheduled game the seed owner can start immediately, returning its id.
 * See the module comment for the two fences and the re-run contract.
 */
export const seedDevGame = internalMutation({
  args: {},
  handler: async (ctx): Promise<Id<'games'>> => {
    assertSeedEnabled()

    const owner = await seedOwner(ctx)
    const homeTeam = await seedTeam(ctx, owner, HOME_TEAM.name)
    const awayTeam = await seedTeam(ctx, owner, AWAY_TEAM.name)
    const home = await seedRoster(ctx, homeTeam, HOME_TEAM)
    const away = await seedRoster(ctx, awayTeam, AWAY_TEAM)

    const game = await ctx.db.insert('games', { homeTeam, awayTeam, ...SCHEDULED_GAME })
    await ctx.db.insert('lineups', { game, team: homeTeam, ...home })
    await ctx.db.insert('lineups', { game, team: awayTeam, ...away })
    return game
  },
})
