import type { HitterAttributes, PitcherAttributes } from '@sandlot/engine/atBat'
import type { GameContext, TeamLineup } from '@sandlot/engine/game'

/**
 * Synthetic roster + lineups for the headless duel adapter (SAN-45).
 *
 * Every value here is invented — **no MLB data, names, or statistics** (IP & data
 * hygiene, AGENTS.md). It exists so the pure adapter (`./adapter`) and its tests
 * can drive the real engine end-to-end without a Convex round-trip; the future
 * Convex client reuses the *adapter*, not this fixture.
 *
 * A player carries exactly one role-appropriate attribute block — the same shape
 * the Convex `players` table models — so `assembleRunnerSpeeds` can detect a
 * pitcher-as-runner from the block and default it to the slowest speed (SAN-16).
 */

/** One synthetic player: a display name, a single role block, and a 1–5
 * base-running speed (distinct from the hitter `speed` attribute; a pitcher's is
 * ignored — a pitcher-as-runner is forced to 1 by the adapter). */
export interface RosterPlayer {
  name: string
  attributes: HitterAttributes | PitcherAttributes
  speed: number
}

/** Player id → player. A read-only Map (not a bare record) keeps id lookups off
 * the object-injection sink and matches the engine's roster-free boundary: the
 * adapter resolves ids → attributes/speed here, never inside the engine. */
export type Roster = ReadonlyMap<string, RosterPlayer>

/** Build a hitter entry. `run` (base-running speed) defaults to the hitter's own
 * speed attribute, the common case. Takes the attribute block as an object so the
 * arg count stays small and the call sites read as the data they are. */
function hitter(
  name: string,
  attributes: HitterAttributes,
  run: number = attributes.speed,
): RosterPlayer {
  return { name, attributes, speed: run }
}

/** Build a pitcher entry. A pitcher-as-runner is always the slowest (1, SAN-16),
 * so its stored base-running speed is 1 — though the adapter forces 1 regardless. */
function pitcher(name: string, attributes: PitcherAttributes): RosterPlayer {
  return { name, attributes, speed: 1 }
}

/**
 * The committed roster. The two batting orders below index into these ids; the
 * away leadoff (`away-1`) and the home pitcher (`home-p`) carry the attribute
 * pairs the adapter tests probe for deterministic hit/walk/out outcomes — keep
 * those two blocks stable or the probed pitch/swing numbers drift.
 */
export const ROSTER: Roster = new Map<string, RosterPlayer>([
  // ── Away ("you" — bats the top half) ──
  ['away-1', hitter('R. VANCE', { power: 3, contact: 3, speed: 3, eye: 5 })],
  ['away-2', hitter('T. JULIEN', { power: 4, contact: 4, speed: 3, eye: 3 })],
  ['away-3', hitter('S. ORTIZ', { power: 5, contact: 3, speed: 2, eye: 3 })],
  ['away-4', hitter('D. MERCER', { power: 5, contact: 2, speed: 1, eye: 2 })],
  ['away-5', hitter('K. ABARA', { power: 3, contact: 4, speed: 4, eye: 4 })],
  ['away-6', hitter('L. FORD', { power: 2, contact: 3, speed: 5, eye: 3 })],
  ['away-7', hitter('N. HALE', { power: 2, contact: 4, speed: 3, eye: 3 })],
  ['away-8', hitter('C. REYES', { power: 1, contact: 3, speed: 4, eye: 2 })],
  ['away-9', hitter('B. KOZN', { power: 1, contact: 2, speed: 3, eye: 2 })],
  ['away-p', pitcher('G. PIKE', { velocity: 4, movement: 3, awareness: 3, command: 3 })],
  // ── Home (the opponent — takes the mound) ──
  ['home-1', hitter('J. WHITLOCK', { power: 3, contact: 4, speed: 3, eye: 3 })],
  ['home-2', hitter('Q. BAKER', { power: 4, contact: 3, speed: 2, eye: 3 })],
  ['home-3', hitter('C. DIAZ', { power: 4, contact: 3, speed: 2, eye: 3 })],
  ['home-4', hitter('M. SLOANE', { power: 5, contact: 2, speed: 2, eye: 2 })],
  ['home-5', hitter('A. PARKER', { power: 3, contact: 3, speed: 3, eye: 4 })],
  ['home-6', hitter('F. NGUYEN', { power: 2, contact: 4, speed: 4, eye: 3 })],
  ['home-7', hitter('W. DRAKE', { power: 2, contact: 3, speed: 3, eye: 3 })],
  ['home-8', hitter('E. SOTO', { power: 1, contact: 3, speed: 4, eye: 2 })],
  ['home-9', hitter('P. ELLIS', { power: 1, contact: 2, speed: 3, eye: 2 })],
  ['home-p', pitcher('H. MARSH', { velocity: 3, movement: 3, awareness: 3, command: 1 })],
])

/** Away lineup: nine hitters in order, plus the designated pitcher. */
export const AWAY_LINEUP: TeamLineup = {
  battingOrder: [
    'away-1',
    'away-2',
    'away-3',
    'away-4',
    'away-5',
    'away-6',
    'away-7',
    'away-8',
    'away-9',
  ],
  pitcher: 'away-p',
}

/** Home lineup: nine hitters in order, plus the designated pitcher. */
export const HOME_LINEUP: TeamLineup = {
  battingOrder: [
    'home-1',
    'home-2',
    'home-3',
    'home-4',
    'home-5',
    'home-6',
    'home-7',
    'home-8',
    'home-9',
  ],
  pitcher: 'home-p',
}

/**
 * The two lineups composed into the engine's `GameContext`. `startGame(GAME_CONTEXT)`
 * seats the away leadoff (`away-1`) against the home pitcher (`home-p`) in the top
 * of the 1st — the matchup the adapter tests resolve.
 */
export const GAME_CONTEXT: GameContext = { home: HOME_LINEUP, away: AWAY_LINEUP }
