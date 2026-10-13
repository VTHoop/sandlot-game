import { v } from 'convex/values'
import type { Doc, Id } from './_generated/dataModel'
import { internalMutation, type MutationCtx } from './_generated/server'
import { isBotSeat } from './bot'
import { gamesOfClubs, userBySubject } from './participants'
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
 * Three mutations, because the work has three lifecycles:
 *
 * - {@link bootstrapDevLeague} stands the league up — the owner, both clubs,
 *   their twenty players, and a scheduled game. Run once on a fresh deployment.
 * - {@link mintDevGame} takes two club ids and appends another scheduled game
 *   between them. Run whenever you want a fresh game.
 * - {@link assignClubToUser} hands one club to a real signed-in account, which
 *   is what turns it into a game participant. Run once per club a human should
 *   hold (SAN-62).
 *
 * {@link devGame} composes the three for the everyday case — a fresh game with
 * real accounts seated, chosen by display name — and is what `pnpm dev:game`
 * runs (SAN-66, SAN-71).
 *
 * Bootstrap cannot stop short of that first game. A player row carries no team
 * column, so the *only* link from a club to its players is a `lineups` row, and
 * `lineups.game` is required — a roster therefore cannot be persisted before a
 * game exists. Standing rosters are the draft/salary-cap project's to invent;
 * a dev fixture does not get to reshape the schema for its own tidiness.
 *
 * All three are fenced twice: each is an `internalMutation` (no browser client
 * can name it in any deployment) **and** none runs unless {@link SEED_ENV_FLAG}
 * is explicitly set to `true` on the deployment. Absence blocks — a fresh
 * deployment is safe before anyone thinks about it.
 *
 * Re-running either game-creating mutation is a supported, additive operation,
 * not an idempotent one.
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
 * owns them. That is what keeps the fixture working after a seeded club is
 * assigned to a real user ({@link assignClubToUser}) — the assignment breaks
 * bootstrap by design, and minting is the path that survives it.
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

/** Whether this deployment opted in. Fail closed: anything other than an explicit
 * `true` is off. Shared with the server-side bot (SAN-58), which plays only where
 * the fixture it plays for can exist. */
export function isSeedEnabled(): boolean {
  return process.env.SANDLOT_DEV_SEED === 'true'
}

/** Fail closed: anything other than an explicit opt-in refuses to run. */
function assertSeedEnabled(): void {
  if (!isSeedEnabled()) {
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
 * split the club's history in half. Handing a club to a real user is
 * {@link assignClubToUser}'s job (SAN-62) — not bootstrap's. Provisioning
 * (SAN-55) only mints the user; it assigns no club.
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
    const owner = await seedOwner(ctx)
    return (await bootstrap(ctx, owner)).game
  },
})

/** The seed's synthetic owner row — the bot's account (SAN-58). */
function seedOwner(ctx: MutationCtx): Promise<Id<'users'>> {
  return upsertUserBySubject(ctx, SEED_CLERK_SUBJECT, SEED_DISPLAY_NAME)
}

/** What a bootstrap run produced: the new game and the two clubs playing it. */
interface BootstrappedGame {
  game: Id<'games'>
  homeTeam: Id<'teams'>
  awayTeam: Id<'teams'>
}

/** Bootstrap's body, for {@link bootstrapDevLeague} and {@link devGame} alike. */
async function bootstrap(ctx: MutationCtx, owner: Id<'users'>): Promise<BootstrappedGame> {
  const clubs = await ownedClubs(ctx, owner)
  assertClubsIntact(clubs)

  const homeTeam = await seedTeam(ctx, clubs, owner, HOME_TEAM.name)
  const awayTeam = await seedTeam(ctx, clubs, owner, AWAY_TEAM.name)

  const game = await mintScheduledGame(
    ctx,
    { team: homeTeam, roster: await clubRoster(ctx, homeTeam, HOME_TEAM) },
    { team: awayTeam, roster: await clubRoster(ctx, awayTeam, AWAY_TEAM) },
  )
  return { game, homeTeam, awayTeam }
}

/**
 * Append another scheduled game between two already-bootstrapped clubs,
 * returning its id.
 *
 * Two ids in, a game out: this asks nothing about who owns the clubs, so it
 * behaves identically before and after one is assigned to a real user (SAN-62).
 * That is the whole reason it is separate from {@link bootstrapDevLeague}, whose
 * owner + name lookup an assignment breaks by design.
 *
 * It does check that the two ids are *usable* — distinct, and each carrying a
 * roster — which is a question about the arguments, not about ownership. Both
 * refusals catch the same caller mistake: the wrong id. Writing the game anyway
 * would leave a club playing itself, or a fork of its roster.
 */
/**
 * Re-point one club at the user behind a Clerk subject (SAN-62). Run from the
 * CLI to turn a real account into a game participant. This is the only way a
 * real user gets a club until the draft/salary-cap work lands — there is no
 * self-serve claiming in the app (SAN-65, ADR-0028), because seed clubs are test
 * fixtures and no public surface should hand them out:
 *
 * ```bash
 * npx convex run seed:assignClubToUser '{"team":"…","clerkSubject":"user_…"}'
 * ```
 *
 * The subject must already resolve to a `users` row — this refuses rather than
 * provisioning one, which keeps `upsertUserBySubject` (SAN-55) the single writer
 * of `users`. `by_clerk_subject` carries no unique constraint, so the `.unique()`
 * read every gate depends on is safe only while one function does the inserting.
 *
 * That row is minted by `users.provision`, which the client calls at sign-in
 * (SAN-38): the account has to sign in to the app once before it can be handed a
 * club. There is no CLI path to mint one — `provision` reads `ctx.auth`, and
 * `npx convex run` carries no identity.
 *
 * Two things it deliberately does NOT check:
 *
 * - **Who holds the club.** Taking one back from a real user is a normal dev
 *   move — resetting the fixture, handing it to a second test account, or
 *   returning it to the bot by passing `SEED_CLERK_SUBJECT` (a seat is the bot's
 *   exactly when the seed owner holds its club — SAN-58, ADR-0027).
 * - **How many clubs the user ends up with.** A solo developer holding both
 *   clubs can play both sides of a duel. Whether real users are limited to one
 *   club is the draft's question to answer, not this tool's.
 *
 * Re-running with the club's current holder is a no-op that succeeds, so the
 * command is safe to repeat.
 */
export const assignClubToUser = internalMutation({
  args: { team: v.id('teams'), clerkSubject: v.string() },
  handler: async (ctx, { team, clerkSubject }): Promise<void> => {
    assertSeedEnabled()

    const user = await userBySubject(ctx, clerkSubject)
    if (!user) {
      throw new Error(
        `Dev seed cannot assign a club to Clerk subject "${clerkSubject}": no users row for it. ` +
          `Only users:provision creates one — sign in as that account once, then re-run.`,
      )
    }

    const club = await ctx.db.get(team)
    if (!club) {
      throw new Error(`Dev seed cannot assign team ${team}: no club by that id.`)
    }

    if (club.owner === user._id) return
    await ctx.db.patch(team, { owner: user._id })
  },
})

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

/** The bot's name in a seating line: a seat the seed owner holds. */
const BOT_NAME = 'bot'

/** What {@link devGame} set up: the new game, who sits where, and what it re-seated. */
export interface DevGameResult {
  game: Id<'games'>
  /** Full display name of the home club's holder, or `bot`. */
  home: string
  /** Full display name of the away club's holder, or `bot`. */
  away: string
  /** Earlier not-yet-started games of the seed clubs whose seating just changed. */
  reseated: number
  /** Earlier games in progress that moved with the clubs — only ever with `force`. */
  inProgress: number
}

/**
 * One step from "signed in" to "a game I'm in" (SAN-66, `pnpm dev:game`): mint a
 * fresh scheduled game with real accounts holding the seed clubs, chosen by
 * display name (SAN-71). `home` seats the home club; `away` seats the away club,
 * or leaves it with the seed owner for the bot to play (SAN-58). Naming the same
 * account for both hands it both clubs.
 *
 * It composes the other three rather than adding a fourth way to do anything:
 * the seed clubs go back to the seed owner from *whoever* holds them, a bootstrap
 * run mints the game against the reassembled league, and the clubs are handed
 * out again. The hand-back happens on every run — bootstrap finds the clubs only
 * through the seed owner — including one that keeps the current seating. All in
 * one transaction, so nothing observes the intermediate ownership.
 *
 * Ownership is per club, so every earlier game of those clubs follows them to
 * their new holders: games not yet started and finished games quietly, a game in
 * progress only with `force` (without it, the run refuses, naming the game and who
 * plays it). A run that keeps the current seating moves nothing, so it is never
 * refused and reports nothing re-seated.
 *
 * With one real account, `home` defaults to it. With several, `home` is required.
 */
export const devGame = internalMutation({
  args: {
    home: v.optional(v.string()),
    away: v.optional(v.string()),
    force: v.optional(v.boolean()),
  },
  handler: async (ctx, { home, away, force = false }): Promise<DevGameResult> => {
    assertSeedEnabled()

    const accounts = await realAccounts(ctx)
    const homeUser = resolveHome(accounts, home)
    const awayUser = away === undefined ? null : resolveByName(accounts, away)
    const owner = await seedOwner(ctx)
    const awayId = awayUser?._id ?? owner

    const moved = await returnSeedClubs(ctx, { home: homeUser._id, away: awayId }, force)
    const { game, homeTeam, awayTeam } = await bootstrap(ctx, owner)
    await ctx.db.patch(homeTeam, { owner: homeUser._id })
    await ctx.db.patch(awayTeam, { owner: awayId })

    return {
      game,
      home: homeUser.displayName,
      away: awayUser?.displayName ?? BOT_NAME,
      ...moved,
    }
  },
})

/** Every signed-in account but the bot's — the only ones a name can match. */
async function realAccounts(ctx: MutationCtx): Promise<Doc<'users'>[]> {
  const users = await ctx.db.query('users').collect()
  return users.filter((user) => user.clerkSubject !== SEED_CLERK_SUBJECT)
}

/** `Sam Hooper (user_abc)`, the way a refusal names a candidate. */
function describeAccounts(accounts: readonly Doc<'users'>[]): string {
  return accounts.map((user) => `${user.displayName} (${user.clerkSubject})`).join(', ')
}

function firstWord(name: string): string {
  return name.trim().split(/\s+/)[0].toLowerCase()
}

/**
 * The one account a name picks out: a whole-name match (ignoring case), else a
 * first-word match. First-word matches count only when no whole name matches, so
 * "Sam" still finds "Sam" when "Sam Hooper" exists. No match, or several at the
 * winning level, refuses and lists the candidates.
 */
function resolveByName(accounts: readonly Doc<'users'>[], name: string): Doc<'users'> {
  const wanted = name.trim().toLowerCase()
  const whole = accounts.filter((user) => user.displayName.trim().toLowerCase() === wanted)
  const matches =
    whole.length > 0 ? whole : accounts.filter((user) => firstWord(user.displayName) === wanted)
  if (matches.length === 1) return matches[0]
  if (matches.length === 0) {
    throw new Error(
      `Dev seed found no account named "${name}". Accounts on this deployment: ` +
        `${describeAccounts(accounts) || 'none'}.`,
    )
  }
  throw new Error(
    `Dev seed found several accounts named "${name}": ${describeAccounts(matches)}. ` +
      `Two accounts with the same display name cannot be seated until one is renamed.`,
  )
}

/** The home account: the one named, else the deployment's only real account. */
function resolveHome(accounts: readonly Doc<'users'>[], home: string | undefined): Doc<'users'> {
  if (home !== undefined) return resolveByName(accounts, home)
  if (accounts.length === 1) return accounts[0]
  if (accounts.length === 0) {
    throw new Error(
      'Dev seed found no signed-in account on this deployment. Sign in to the app once, then re-run.',
    )
  }
  throw new Error(
    `Dev seed found several accounts (${describeAccounts(accounts)}); --home is required.`,
  )
}

/** Both seed clubs, whoever holds them. Dev data is small enough to read whole. */
async function seedClubs(ctx: MutationCtx): Promise<Doc<'teams'>[]> {
  const seedNames = new Set([HOME_TEAM.name, AWAY_TEAM.name])
  const teams = await ctx.db.query('teams').collect()
  return teams.filter((club) => seedNames.has(club.name))
}

/**
 * Who holds a club, by display name, for a refusal to quote: `bot` for a seat the
 * seed owner holds (ADR-0027), else the holder's name. A club or holder that does
 * not exist is corrupt data, so this throws rather than calling it the bot.
 */
async function holderName(ctx: MutationCtx, team: Id<'teams'>): Promise<string> {
  if (await isBotSeat(ctx, team)) return BOT_NAME
  const club = await ctx.db.get(team)
  if (!club) throw new Error(`Dev seed cannot name the holder of team ${team}: no club by that id.`)
  const holder = await ctx.db.get(club.owner)
  if (!holder) {
    throw new Error(
      `Dev seed cannot name the holder of club "${club.name}": no users row for its owner.`,
    )
  }
  return holder.displayName
}

/** `Sam (home) vs. bot (away)` for a game as its clubs are held right now. */
async function playersOf(ctx: MutationCtx, game: Doc<'games'>): Promise<string> {
  const [home, away] = await Promise.all([
    holderName(ctx, game.homeTeam),
    holderName(ctx, game.awayTeam),
  ])
  return `${home} (home) vs. ${away} (away)`
}

/** What taking the clubs back moved: games not yet started, and games in progress. */
type Moved = Pick<DevGameResult, 'reseated' | 'inProgress'>

/**
 * The earlier games the clubs' move re-seats, or refusal when one is in progress
 * and `force` is off. A move that keeps the current seating re-seats nothing.
 */
async function gamesMoved(
  ctx: MutationCtx,
  clubs: readonly Doc<'teams'>[],
  seating: { home: Id<'users'>; away: Id<'users'> },
  force: boolean,
): Promise<Moved> {
  const holder = (name: string) => clubs.find((club) => club.name === name)?.owner
  if (holder(HOME_TEAM.name) === seating.home && holder(AWAY_TEAM.name) === seating.away) {
    return { reseated: 0, inProgress: 0 }
  }

  const games = await gamesOfClubs(
    ctx,
    clubs.map((club) => club._id),
  )
  const live = games.filter((game) => game.status === 'live')
  if (live.length > 0 && !force) {
    const named = await Promise.all(
      live.map(async (game) => `${game._id}: ${await playersOf(ctx, game)}`),
    )
    throw new Error(
      `Dev seed would re-seat a game in progress — ${named.join('; ')}. ` +
        `Pass --force to re-seat it anyway.`,
    )
  }
  return {
    reseated: games.filter((game) => game.status === 'scheduled').length,
    inProgress: live.length,
  }
}

/**
 * Hand the seed clubs back to the seed owner from whoever holds them, so
 * bootstrap finds its two — on every run, whether or not the seating changes.
 */
async function returnSeedClubs(
  ctx: MutationCtx,
  seating: { home: Id<'users'>; away: Id<'users'> },
  force: boolean,
): Promise<Moved> {
  const clubs = await seedClubs(ctx)
  const moved = await gamesMoved(ctx, clubs, seating, force)
  const owner = await seedOwner(ctx)
  await Promise.all(clubs.map((club) => ctx.db.patch(club._id, { owner })))
  return moved
}
