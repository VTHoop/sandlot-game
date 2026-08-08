import { v } from 'convex/values'
import type { Doc, Id } from './_generated/dataModel'
import { internalMutation, type MutationCtx } from './_generated/server'
import { AWAY_TEAM, HOME_TEAM, type PitcherSpec, type TeamSpec } from './seedRoster'
import { upsertUserBySubject } from './users'

/**
 * Dev-only fixture seed (SAN-54, split in SAN-61).
 *
 * `game.startGame` needs a scheduled game with two owned teams and two complete
 * lineups behind it, and nothing in the app creates one yet — the draft, salary
 * cap, and MLB ingest that eventually will are their own projects. This mints
 * that game so local development and manual QA have something to play.
 *
 * Two mutations, because the work has two lifecycles:
 *
 * - {@link bootstrapDevLeague} stands the league up — the owner, both clubs,
 *   their twenty players, and a scheduled game. Run once on a fresh deployment.
 * - {@link mintDevGame} takes two club ids and appends another scheduled game
 *   between them. Run whenever you want a fresh game.
 *
 * Bootstrap cannot stop short of that first game. A player row carries no team
 * column, so the *only* link from a club to its players is a `lineups` row, and
 * `lineups.game` is required — a roster therefore cannot be persisted before a
 * game exists. Standing rosters are the draft/salary-cap project's to invent;
 * a dev fixture does not get to reshape the schema for its own tidiness.
 *
 * Both are fenced twice: each is an `internalMutation` (no browser client can
 * name it in any deployment) **and** neither runs unless {@link SEED_ENV_FLAG}
 * is explicitly set to `true` on the deployment. Absence blocks — a fresh
 * deployment is safe before anyone thinks about it.
 *
 * Re-running either is a supported, additive operation, not an idempotent one.
 * Bootstrap creates the owner, both clubs, and their twenty players on its first
 * run and reuses all of them verbatim forever after; minting creates none of
 * that, reusing whatever roster the clubs it was handed already field. Every run
 * of either appends a *new* scheduled game and its two lineups. Nothing is ever
 * deleted or patched, so earlier games stay playable history.
 *
 * Only bootstrap identifies a club by owner + name, and the product may change
 * both — so {@link assertClubsIntact} re-checks that assumption on every run and
 * refuses when a club has moved. Minting deliberately asks no such question: it
 * is handed two ids, and never looks up, infers, or asserts anything about who
 * owns them. That is what keeps the fixture working after a real user claims a
 * seeded club (SAN-62) — the claim breaks bootstrap by design, and minting is
 * the path that survives it.
 *
 * Every reuse lookup here is read-then-insert *into the range it just read*,
 * which is what makes them safe without a unique constraint (none of these
 * tables has one): two concurrent runs overlap read and write sets, so Convex's
 * serializable OCC conflicts one and retries it, and the retry sees the
 * committed row and reuses it. That holds for minting too — it reads a club's
 * `by_team` lineup range and then writes a lineup into it. The same discipline
 * as the duel's ordinal (SAN-20). The owner lookup is the shared
 * `upsertUserBySubject` (SAN-55) — the seed is just another caller of it,
 * holding a subject Clerk cannot issue.
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

/** Every club the seed owner holds — the seed's whole world, read once. */
function ownedClubs(ctx: MutationCtx, owner: Id<'users'>): Promise<Doc<'teams'>[]> {
  return ctx.db
    .query('teams')
    .withIndex('by_owner', (q) => q.eq('owner', owner))
    .collect()
}

/**
 * The seed identifies a club by owner + name, and the product is free to change
 * both — a club can be renamed, or re-pointed at a real signed-in user. There is
 * no marker on the row to follow it by, and adding one would put a throwaway
 * fixture's bookkeeping permanently into a production entity, so the seed
 * verifies its assumption every run instead of trusting it.
 *
 * Anything other than "no clubs yet" or "exactly my two" means a club left. The
 * seed refuses rather than minting a replacement: a replacement would carry no
 * prior lineup, so it would silently fork ten more players off the roster and
 * split the club's history in half. Handing a club to a real user, and what the
 * fixture should do afterwards, is the claiming ticket's job (SAN-62) — not this
 * fixture's. Provisioning (SAN-55) only mints the user; it claims nothing.
 */
function assertClubsIntact(clubs: Doc<'teams'>[]): void {
  const names = clubs.map((club) => club.name)
  const intact =
    names.length === 0 ||
    (names.length === 2 && names.includes(HOME_TEAM.name) && names.includes(AWAY_TEAM.name))
  if (intact) return
  throw new Error(
    `Dev seed found ${names.length} club(s) owned by ${SEED_CLERK_SUBJECT} ` +
      `[${names.join(', ')}] — expected either none or exactly ` +
      `[${HOME_TEAM.name}, ${AWAY_TEAM.name}]. A seeded club was renamed or ` +
      `re-pointed at another user; the seed cannot follow it and will not mint a ` +
      `duplicate. Restore the club's owner and name, or clear the seeded data.`,
  )
}

/**
 * One club, reused from the owner's clubs or created on the first run. Both
 * clubs share the one owner, so a single identity can act for both sides.
 */
async function seedTeam(
  ctx: MutationCtx,
  clubs: Doc<'teams'>[],
  owner: Id<'users'>,
  name: string,
): Promise<Id<'teams'>> {
  const existing = clubs.find((club) => club.name === name)
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

/** One side of a game: a club and the nine-plus-one it fields. */
interface Side {
  team: Id<'teams'>
  roster: Roster
}

/**
 * The club's standing roster, or null on a club that has never played. A player
 * has no team column — the only link from a team to its players is a `lineups`
 * row — so "does this club already have players?" is answered by its earliest
 * lineup, and that lineup's slots are reused verbatim.
 */
async function priorRoster(ctx: MutationCtx, team: Id<'teams'>): Promise<Roster | null> {
  const prior = await ctx.db
    .query('lineups')
    .withIndex('by_team', (q) => q.eq('team', team))
    .first()
  return prior ? { battingOrder: prior.battingOrder, pitcher: prior.pitcher } : null
}

/**
 * Bootstrap's roster: reused when the club has played, invented on the first
 * run. Every run after the first therefore fields the same twenty players in
 * the same order without touching a single existing row.
 */
async function clubRoster(ctx: MutationCtx, team: Id<'teams'>, spec: TeamSpec): Promise<Roster> {
  const prior = await priorRoster(ctx, team)
  if (prior) return prior
  return {
    battingOrder: await insertBattingOrder(ctx, spec),
    pitcher: await insertPitcher(ctx, spec.pitcher),
  }
}

/**
 * Minting's roster: the club's players already exist by the time this path is
 * reachable, so a club without them means the caller passed the wrong id.
 * Inventing a second set here would be the same silent fork
 * {@link assertClubsIntact} refuses to make — ten more players off the roster
 * and the club's history split in half — so this refuses instead.
 */
async function requireRoster(ctx: MutationCtx, team: Id<'teams'>): Promise<Roster> {
  const roster = await priorRoster(ctx, team)
  if (roster) return roster
  const club = await ctx.db.get(team)
  throw new Error(
    `Dev seed cannot mint a game for ${club ? `club "${club.name}"` : `team ${team}`}: it has ` +
      `no roster, and minting one here would fork the club's players. Only the bootstrap ` +
      `mutation creates players. Run it first, or pass the ids of two bootstrapped clubs.`,
  )
}

/** The scheduled game plus a lineup a side, returning the new game's id. */
async function mintScheduledGame(ctx: MutationCtx, home: Side, away: Side): Promise<Id<'games'>> {
  const game = await ctx.db.insert('games', {
    homeTeam: home.team,
    awayTeam: away.team,
    ...SCHEDULED_GAME,
  })
  await ctx.db.insert('lineups', { game, team: home.team, ...home.roster })
  await ctx.db.insert('lineups', { game, team: away.team, ...away.roster })
  return game
}

/**
 * Stand up the dev league and mint a game the seed owner can start immediately,
 * returning that game's id. Run once on a fresh deployment; re-running reuses
 * the owner, both clubs, and their rosters and appends another game.
 *
 * See the module comment for the two fences, the re-run contract, and why this
 * cannot stop short of the first game.
 */
export const bootstrapDevLeague = internalMutation({
  args: {},
  handler: async (ctx): Promise<Id<'games'>> => {
    assertSeedEnabled()

    const owner = await upsertUserBySubject(ctx, SEED_CLERK_SUBJECT, SEED_DISPLAY_NAME)
    const clubs = await ownedClubs(ctx, owner)
    assertClubsIntact(clubs)

    const homeTeam = await seedTeam(ctx, clubs, owner, HOME_TEAM.name)
    const awayTeam = await seedTeam(ctx, clubs, owner, AWAY_TEAM.name)

    return mintScheduledGame(
      ctx,
      { team: homeTeam, roster: await clubRoster(ctx, homeTeam, HOME_TEAM) },
      { team: awayTeam, roster: await clubRoster(ctx, awayTeam, AWAY_TEAM) },
    )
  },
})

/**
 * Append another scheduled game between two already-bootstrapped clubs,
 * returning its id.
 *
 * Two ids in, a game out: this asks nothing about who owns the clubs, so it
 * behaves identically before and after a real user claims one (SAN-62). That is
 * the whole reason it is separate from {@link bootstrapDevLeague}, whose
 * owner + name lookup a claim breaks by design.
 *
 * It does check that the two ids are *usable* — distinct, and each carrying a
 * roster — which is a question about the arguments, not about ownership. Both
 * refusals catch the same caller mistake: the wrong id. Writing the game anyway
 * would leave a club playing itself, or a fork of its roster.
 */
export const mintDevGame = internalMutation({
  args: { homeTeam: v.id('teams'), awayTeam: v.id('teams') },
  handler: async (ctx, { homeTeam, awayTeam }): Promise<Id<'games'>> => {
    assertSeedEnabled()
    if (homeTeam === awayTeam) {
      throw new Error(
        `Dev seed cannot mint a game for team ${homeTeam} against itself. Bootstrap builds two ` +
          `distinct clubs; pass both of their ids.`,
      )
    }

    return mintScheduledGame(
      ctx,
      { team: homeTeam, roster: await requireRoster(ctx, homeTeam) },
      { team: awayTeam, roster: await requireRoster(ctx, awayTeam) },
    )
  },
})
