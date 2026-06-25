import type { OutcomeBandKey } from '@sandlot/engine/outcomes'
import { type Infer, v } from 'convex/values'

/**
 * Shared field validators reused across the schema so every enumerated domain
 * (outcome bands, roles, positions, game status, half-innings, base state,
 * player attributes) is defined exactly once. No `v.any()` anywhere.
 */

/**
 * At-bat outcome band keys, mirroring the engine's RangeFinder band stack
 * (`HR → 3B → 2B → 1B → IF1B → BB → FO → PO → GB → K`). The compile-time guard
 * below ties this validator to {@link OutcomeBandKey} so the persisted enum can
 * never drift from the engine's actual outcomes — the engine is the single
 * source of truth. Listed as explicit literals (not built from the engine tuple
 * at runtime) so Convex infers the precise union into the generated `Doc` types
 * and so this validator carries no engine runtime dependency.
 */
export const outcomeBand = v.union(
  v.literal('HR'),
  v.literal('3B'),
  v.literal('2B'),
  v.literal('1B'),
  v.literal('IF1B'),
  v.literal('BB'),
  v.literal('FO'),
  v.literal('PO'),
  v.literal('GB'),
  v.literal('K'),
)

// Compile-time single-source-of-truth guard: fails typecheck if the literals
// above diverge from the engine's band keys (in either direction).
type AssertEqual<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : never
const _outcomeMatchesEngine: AssertEqual<Infer<typeof outcomeBand>, OutcomeBandKey> = true
void _outcomeMatchesEngine

/** Roster role: drives which attribute block a player carries. */
export const role = v.union(v.literal('hitter'), v.literal('pitcher'))

/** Where a player came from: a real MLB import or a user-created custom player. */
export const playerSource = v.union(v.literal('mlb'), v.literal('custom'))

/** Defensive position / lineup slot. */
export const position = v.union(
  v.literal('P'),
  v.literal('C'),
  v.literal('1B'),
  v.literal('2B'),
  v.literal('3B'),
  v.literal('SS'),
  v.literal('LF'),
  v.literal('CF'),
  v.literal('RF'),
  v.literal('DH'),
)

/** Authoritative game lifecycle state. */
export const gameStatus = v.union(v.literal('scheduled'), v.literal('live'), v.literal('final'))

/** Which half of the inning is being played. */
export const half = v.union(v.literal('top'), v.literal('bottom'))

/**
 * Which side committed a secret number in a duel. The vault is symmetric —
 * either side may lock first and the server resolves once both are present
 * (order-independent commits, ADR-0014) — so each sealed number is tagged with
 * the role that produced it.
 */
export const duelRole = v.union(v.literal('pitching'), v.literal('batting'))

/**
 * A 1–5 attribute rating. Modeled as a literal union so the 1–5 bound is a
 * schema-level guarantee (Convex's `v` validators don't express numeric ranges).
 * Internal to this module — composed into `attributes`; export when a downstream
 * ticket needs it directly.
 */
const rating = v.union(v.literal(1), v.literal(2), v.literal(3), v.literal(4), v.literal(5))

/**
 * Runner-aware base state (SAN-44): each base references the player standing on
 * it (`Id<'players'>`), or null when empty — mirroring the engine's `BaseState`
 * (opaque `RunnerId | null` per base) and following the `currentBatter` /
 * `currentPitcher` player-reference pattern. Reused for a game's live state and
 * the pre/post state recorded on each immutable at-bat log entry. The
 * `baseState validator` test in `validators.test.ts` anchors these field names
 * to the engine's `BaseState` shape (the runtime twin of the boundary cast).
 */
export const baseState = v.object({
  first: v.union(v.id('players'), v.null()),
  second: v.union(v.id('players'), v.null()),
  third: v.union(v.id('players'), v.null()),
})

/** Hitter attribute block (`power − velocity`, `speed − awareness`,
 * `eye − command`, `contact − movement` matchups drive the outcome bands).
 * Internal — composed into `attributes`; export when a ticket needs it. */
const hitterAttributes = v.object({
  power: rating,
  contact: rating,
  speed: rating,
  eye: rating,
})

/** Pitcher attribute block — the defensive counterpart to the hitter block. */
const pitcherAttributes = v.object({
  velocity: rating,
  movement: rating,
  awareness: rating,
  command: rating,
})

/** A player carries exactly one attribute block, matching its {@link role}. */
export const attributes = v.union(hitterAttributes, pitcherAttributes)
