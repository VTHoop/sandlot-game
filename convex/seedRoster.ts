import type { Doc } from './_generated/dataModel'

/**
 * The two synthetic clubs the dev seed fields (SAN-54).
 *
 * Every value here is invented — **no MLB data, names, or statistics** (IP &
 * data hygiene, AGENTS.md / ADR-0006). This is the server-side sibling of
 * `src/design/duel/roster.ts`: that fixture never leaves the browser, this one
 * is what `convex/seed.ts` writes into `players` so `game.startGame` finally
 * has something to start. Both are placeholders — the draft, salary cap, and
 * MLB ingest replace this with real roster building.
 *
 * The shape is data only: `seed.ts` owns every database decision. Keeping the
 * roster here means the seed's control flow stays readable next to the twenty
 * players it inserts.
 */

type PlayerAttributes = Doc<'players'>['attributes']
type HitterAttributes = Extract<PlayerAttributes, { power: number }>
type PitcherAttributes = Extract<PlayerAttributes, { velocity: number }>

/** A batting slot's position — the nine non-`P` slots, one of each per side. */
type FieldPosition = Exclude<Doc<'players'>['position'], 'P'>

/** One batter: the position it fills in the order and its own attribute block.
 * Reachable structurally through {@link TeamSpec}; not exported by name because
 * nothing outside this module names it. */
interface HitterSpec {
  name: string
  position: FieldPosition
  attributes: HitterAttributes
}

/** The designated pitcher. Its position is always `P` — it never bats. */
export interface PitcherSpec {
  name: string
  attributes: PitcherAttributes
}

/**
 * One club: a fixed name (half of how the seed recognizes the club again —
 * `assertClubsIntact` in `./seed` explains why that recognition is checked
 * rather than trusted), a nine-deep batting order in array order, and the arm
 * behind it.
 */
export interface TeamSpec {
  name: string
  battingOrder: readonly HitterSpec[]
  pitcher: PitcherSpec
}

/**
 * The visiting club — bats the top of the 1st, so `battingOrder[0]` is the
 * first batter a seeded game ever seats.
 *
 * Every hitter attribute below spans at least three distinct 1–5 ratings across
 * the nine slots, so the `power − velocity` / `speed − awareness` /
 * `eye − command` / `contact − movement` differentials actually vary from batter
 * to batter instead of resolving every at-bat off the same band.
 */
export const AWAY_TEAM: TeamSpec = {
  name: 'Harbor Street Hooks',
  battingOrder: [
    { name: 'D. QUILL', position: 'CF', attributes: { power: 2, contact: 4, speed: 5, eye: 4 } },
    { name: 'M. ASHGROVE', position: 'SS', attributes: { power: 3, contact: 4, speed: 4, eye: 3 } },
    { name: 'T. RENNICK', position: '1B', attributes: { power: 5, contact: 3, speed: 2, eye: 4 } },
    { name: 'B. HOLLIS', position: 'LF', attributes: { power: 5, contact: 2, speed: 1, eye: 3 } },
    { name: 'S. VARNEY', position: '3B', attributes: { power: 4, contact: 3, speed: 3, eye: 2 } },
    { name: 'K. DRAYTON', position: 'DH', attributes: { power: 3, contact: 3, speed: 2, eye: 5 } },
    { name: 'J. FENWICK', position: '2B', attributes: { power: 2, contact: 5, speed: 3, eye: 3 } },
    { name: 'A. PELL', position: 'C', attributes: { power: 1, contact: 3, speed: 1, eye: 2 } },
    { name: 'R. STOKELY', position: 'RF', attributes: { power: 4, contact: 2, speed: 4, eye: 1 } },
  ],
  pitcher: {
    name: 'W. CALLOWAY',
    attributes: { velocity: 4, movement: 3, awareness: 2, command: 3 },
  },
}

/**
 * The home club — takes the mound first, so its `pitcher` is the arm a seeded
 * game seats opposite the away leadoff. Its block differs from the away arm's
 * so the two halves of an inning don't play out against identical defence.
 */
export const HOME_TEAM: TeamSpec = {
  name: 'Ridgeline Ramblers',
  battingOrder: [
    { name: 'E. LARKIN', position: '2B', attributes: { power: 2, contact: 5, speed: 4, eye: 4 } },
    { name: 'C. MABRY', position: 'CF', attributes: { power: 3, contact: 4, speed: 5, eye: 3 } },
    { name: 'N. TALBOT', position: 'RF', attributes: { power: 4, contact: 4, speed: 3, eye: 4 } },
    { name: 'G. HUXLEY', position: '1B', attributes: { power: 5, contact: 3, speed: 1, eye: 3 } },
    { name: 'P. RIDDICK', position: '3B', attributes: { power: 5, contact: 2, speed: 2, eye: 2 } },
    { name: 'L. BRANNOCK', position: 'LF', attributes: { power: 3, contact: 3, speed: 3, eye: 5 } },
    { name: 'V. ASHFORD', position: 'SS', attributes: { power: 2, contact: 4, speed: 4, eye: 2 } },
    { name: 'O. TEAGUE', position: 'C', attributes: { power: 1, contact: 3, speed: 2, eye: 3 } },
    { name: 'H. WREN', position: 'DH', attributes: { power: 4, contact: 2, speed: 1, eye: 1 } },
  ],
  pitcher: {
    name: 'F. MOSSLEY',
    attributes: { velocity: 3, movement: 4, awareness: 3, command: 2 },
  },
}
