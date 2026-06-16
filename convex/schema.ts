import { defineSchema, defineTable } from 'convex/server'
import { v } from 'convex/values'
import {
  attributes,
  baseState,
  duelRole,
  gameStatus,
  half,
  outcomeBand,
  playerSource,
  position,
  role,
} from './validators'

/**
 * Multiplayer data model (SAN-19) — schema only.
 *
 * Shape follows ADR-0004: authoritative current-state rows (`games`, `lineups`)
 * + an append-only `atBats` log + maintained rollups (`standings`,
 * `playerStatLine`, `boxScoreLine`). NOT full event sourcing — state is never
 * rebuilt by replay. Mutations, queries, rollup maintenance, append-only
 * enforcement, secrecy read-paths, and salary-cap logic all belong to
 * downstream Multiplayer/League tickets; this ticket defines tables, field
 * validators, indexes, and the exported types only. Enumerated domains live in
 * `./validators` so each is defined once; the `outcomeBand` enum mirrors the
 * engine's RangeFinder band names (single source of truth).
 *
 * Numeric ranges Convex validators can't express (pitch/swing `number` 1–999,
 * batting order length 1–9) are enforced by the insert-only access functions
 * added in later tickets.
 */
export default defineSchema({
  // Clerk-backed account: `clerkSubject` is `ctx.auth.subject` from the Clerk
  // JWT (see docs/ARCHITECTURE.md). Owns teams.
  users: defineTable({
    clerkSubject: v.string(),
    displayName: v.string(),
  }).index('by_clerk_subject', ['clerkSubject']),

  teams: defineTable({
    owner: v.id('users'),
    name: v.string(),
  }).index('by_owner', ['owner']),

  // Real (MLB-imported) or custom players. A player carries the attribute block
  // matching its role (hitter vs pitcher). `price` is nullable until derived by
  // the balance/salary-cap pipeline.
  players: defineTable({
    name: v.string(),
    source: playerSource,
    role,
    position,
    price: v.union(v.float64(), v.null()),
    attributes,
  })
    .index('by_source', ['source'])
    .index('by_role', ['role']),

  // Authoritative current game state. `currentBatter`/`currentPitcher` are null
  // until the game goes live. A game references two teams, so team lookups use
  // separate home/away indexes (a single index cannot match the away side).
  games: defineTable({
    homeTeam: v.id('teams'),
    awayTeam: v.id('teams'),
    inning: v.float64(),
    half,
    outs: v.float64(),
    bases: baseState,
    homeScore: v.float64(),
    awayScore: v.float64(),
    status: gameStatus,
    currentBatter: v.union(v.id('players'), v.null()),
    currentPitcher: v.union(v.id('players'), v.null()),
  })
    .index('by_status', ['status'])
    .index('by_home_team', ['homeTeam'])
    .index('by_away_team', ['awayTeam']),

  // Per-team lineup for a game: an ordered 1–9 batting list (array order IS the
  // batting order) plus the designated pitcher.
  lineups: defineTable({
    game: v.id('games'),
    team: v.id('teams'),
    battingOrder: v.array(
      v.object({
        player: v.id('players'),
        position,
      }),
    ),
    pitcher: v.id('players'),
  })
    .index('by_game', ['game'])
    .index('by_team', ['team']),

  // SECRET VAULT. Each committed duel number (pitch or swing) lives only here,
  // in its own table by design, so no public/at-bat read path can reach it
  // (game-integrity rule). The vault is symmetric: either side may lock first
  // and the server resolves once both are present (order-independent commits,
  // ADR-0014), so a row is keyed by the at-bat's pre-resolution identity plus
  // the committing `role` — `(game, sequence, role)`. It cannot reference an
  // `atBats` row (that row is appended only at resolution); `sequence` matches
  // the eventual `atBats.sequence`. Range (1–999) and the secrecy read-paths are
  // enforced by `convex/atBat.ts` (SAN-20).
  duelCommitments: defineTable({
    game: v.id('games'),
    sequence: v.float64(),
    role: duelRole,
    player: v.id('players'),
    number: v.float64(), // 1–999; range enforced by the commit mutation
    createdAt: v.float64(),
  }).index('by_game', ['game', 'sequence', 'role']),

  // APPEND-ONLY LOG (ADR-0004). Each entry carries complete pre- and post-state
  // so rows are never mutated — append-only is enforced by the insert-only
  // access functions added in later tickets. `outcome` mirrors the engine's
  // band keys. Ordered within a game by `sequence`.
  atBats: defineTable({
    game: v.id('games'),
    sequence: v.float64(),
    inning: v.float64(),
    half,
    batter: v.id('players'),
    pitcher: v.id('players'),
    outsBefore: v.float64(),
    basesBefore: baseState,
    batterNumber: v.float64(), // committed swing number, 1–999
    pitchNumber: v.float64(), // committed pitch number, 1–999
    outcome: outcomeBand,
    runsScored: v.float64(),
    rbi: v.float64(),
    basesAfter: baseState,
    outsAfter: v.float64(),
    createdAt: v.float64(),
  }).index('by_game', ['game', 'sequence']),

  // --- Rollups (maintained aggregates; kept in sync with the log by later
  // tickets, per ADR-0004) ---

  standings: defineTable({
    team: v.id('teams'),
    wins: v.float64(),
    losses: v.float64(),
    runsFor: v.float64(),
    runsAgainst: v.float64(),
  }).index('by_team', ['team']),

  // Counting stats that feed the engine's SlashLine inputs
  // (avg = h/ab, obp = (h+bb)/pa, slg = tb/ab, hrPct/kPct/bbPct). `doubles`/
  // `triples` are the 2B/3B counts (JS identifiers can't start with a digit).
  playerStatLine: defineTable({
    player: v.id('players'),
    pa: v.float64(),
    ab: v.float64(),
    h: v.float64(),
    doubles: v.float64(),
    triples: v.float64(),
    hr: v.float64(),
    bb: v.float64(),
    k: v.float64(),
    tb: v.float64(),
  }).index('by_player', ['player']),

  boxScoreLine: defineTable({
    game: v.id('games'),
    team: v.id('teams'),
    runs: v.float64(),
    hits: v.float64(),
    errors: v.float64(),
  }).index('by_game', ['game']),
})
