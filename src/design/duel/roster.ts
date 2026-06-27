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
 * speed attribute, the common case. */
function hitter(
  name: string,
  power: number,
  contact: number,
  speed: number,
  eye: number,
  run: number = speed,
): RosterPlayer {
  return { name, attributes: { power, contact, speed, eye }, speed: run }
}

/** Build a pitcher entry. A pitcher-as-runner is always the slowest (1, SAN-16),
 * so its stored base-running speed is 1 — though the adapter forces 1 regardless. */
function pitcher(
  name: string,
  velocity: number,
  movement: number,
  awareness: number,
  command: number,
): RosterPlayer {
  return { name, attributes: { velocity, movement, awareness, command }, speed: 1 }
}

/**
 * The committed roster. The two batting orders below index into these ids; the
 * away leadoff (`away-1`) and the home pitcher (`home-p`) carry the attribute
 * pairs the adapter tests probe for deterministic hit/walk/out outcomes — keep
 * those two blocks stable or the probed pitch/swing numbers drift.
 */
export const ROSTER: Roster = new Map<string, RosterPlayer>([
  // ── Away ("you" — bats the top half) ──
  ['away-1', hitter('R. VANCE', 3, 3, 3, 5)],
  ['away-2', hitter('T. JULIEN', 4, 4, 3, 3)],
  ['away-3', hitter('S. ORTIZ', 5, 3, 2, 3)],
  ['away-4', hitter('D. MERCER', 5, 2, 1, 2)],
  ['away-5', hitter('K. ABARA', 3, 4, 4, 4)],
  ['away-6', hitter('L. FORD', 2, 3, 5, 3)],
  ['away-7', hitter('N. HALE', 2, 4, 3, 3)],
  ['away-8', hitter('C. REYES', 1, 3, 4, 2)],
  ['away-9', hitter('B. KOZN', 1, 2, 3, 2)],
  ['away-p', pitcher('G. PIKE', 4, 3, 3, 3)],
  // ── Home (the opponent — takes the mound) ──
  ['home-1', hitter('J. WHITLOCK', 3, 4, 3, 3)],
  ['home-2', hitter('Q. BAKER', 4, 3, 2, 3)],
  ['home-3', hitter('C. DIAZ', 4, 3, 2, 3)],
  ['home-4', hitter('M. SLOANE', 5, 2, 2, 2)],
  ['home-5', hitter('A. PARKER', 3, 3, 3, 4)],
  ['home-6', hitter('F. NGUYEN', 2, 4, 4, 3)],
  ['home-7', hitter('W. DRAKE', 2, 3, 3, 3)],
  ['home-8', hitter('E. SOTO', 1, 3, 4, 2)],
  ['home-9', hitter('P. ELLIS', 1, 2, 3, 2)],
  ['home-p', pitcher('H. MARSH', 3, 3, 3, 1)],
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
