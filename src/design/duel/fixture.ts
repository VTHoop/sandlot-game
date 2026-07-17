import type { DuelMatchup } from './MatchupCard'
import { type DuelSituation, FieldSpot, type RevealScenario } from './scenario'

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
} satisfies DuelMatchup

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
  headline: 'DOUBLE!',
  movements: [
    { from: FieldSpot.Second, to: FieldSpot.Home, retired: false },
    { from: FieldSpot.Batter, to: FieldSpot.Second, retired: false },
  ],
}

/**
 * The commit/waiting view of the showcase scenario, built by naming only the
 * non-secret fields — the derived object literally has no `you`/`them` slot to
 * leak the pitch through (secret-state law, ADR-0014).
 */
export const SHOWCASE_SITUATION = {
  opponent: SHOWCASE_SCENARIO.opponent,
  inning: SHOWCASE_SCENARIO.inning,
  half: SHOWCASE_SCENARIO.half,
  outs: SHOWCASE_SCENARIO.outs,
  scoreBefore: SHOWCASE_SCENARIO.scoreBefore,
  hitsBefore: SHOWCASE_SCENARIO.hitsBefore,
  // Mirrors the scenario's movements: the runner the double scores starts on 2nd.
  runnersOn: [FieldSpot.Second],
} satisfies DuelSituation
