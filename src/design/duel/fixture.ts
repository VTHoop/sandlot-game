import type { RevealScenario } from './scenario'

/**
 * Fake fixture data for the parked showcase: bottom 8th, tie game — a double
 * that scores the runner from 2nd stacks RBI + lead change + late-and-close.
 * The batter seat receives only `pitcherLocked` — never `them`
 * (secret-state law, AGENTS.md Game integrity).
 */
/**
 * Player-level matchup context for the commit screen (managers duel; players
 * match up). Names are first initial + last name.
 */
export const SHOWCASE_MATCHUP = {
  you: {
    pitcher: { name: 'A. PARKER', attrs: { VEL: 4, MOV: 3, CMD: 2 } },
    batter: { name: 'T. JULIEN', attrs: { PWR: 3, CON: 4, SPD: 3, EYE: 5 } },
    dueUp: ['R. VANCE', 'S. ORTIZ'],
  },
  opponent: {
    pitcher: { name: 'M. SLOANE', attrs: { VEL: 3, MOV: 4, CMD: 3 } },
    batter: { name: 'C. DIAZ', attrs: { PWR: 4, CON: 3, SPD: 2, EYE: 3 } },
    dueUp: ['J. WHITLOCK', 'Q. BAKER'],
  },
} as const

export const SHOWCASE_SCENARIO: RevealScenario = {
  you: 472,
  them: 519,
  opponent: 'Maddie',
  outcome: '2B',
  inning: 8,
  half: 'BOTTOM',
  outs: 2,
  runsScored: 1,
  scoreBefore: { you: 4, opp: 4 },
  hitsBefore: { you: 7, opp: 6 },
  scoreline: 'Your runner scores from 2nd · you stand on 2nd',
}
