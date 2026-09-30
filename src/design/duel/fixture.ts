import type { DuelMatchup } from './MatchupCard'
import { type DuelSituation, FieldSpot, type RevealScenario } from './scenario'

/**
 * The showcase at-bat's matchup (managers duel; players match up). Names are
 * first initial + last name. One matchup: both seats look at the same two
 * players.
 */
export const SHOWCASE_MATCHUP = {
  pitcher: { name: 'M. SLOANE', attrs: { VEL: 3, MOV: 4, CMD: 3 } },
  batter: { name: 'T. JULIEN', attrs: { PWR: 3, CON: 4, SPD: 3, EYE: 5 } },
  dueUp: ['R. VANCE', 'S. ORTIZ'],
} satisfies DuelMatchup

/**
 * A go-ahead double in the bottom of the fifth: the home club (RID) breaks a tie
 * one inning short of regulation, so the reveal shows a lead change and the
 * late-and-close beat without being a walk-off.
 */
export const SHOWCASE_SCENARIO: RevealScenario = {
  pitch: 519,
  swing: 472,
  pitcher: SHOWCASE_MATCHUP.pitcher.name,
  batter: SHOWCASE_MATCHUP.batter.name,
  clubs: { away: 'HAR', home: 'RID' },
  outcome: '2B',
  inning: 5,
  half: 'BOTTOM',
  outs: 2,
  runsScored: 1,
  scoreBefore: { away: 4, home: 4 },
  hitsBefore: { away: 6, home: 7 },
  scoreline: '1 run scores · T. JULIEN stands on 2nd',
  headline: 'DOUBLE!',
  movements: [
    { from: FieldSpot.Second, to: FieldSpot.Home, retired: false },
    { from: FieldSpot.Batter, to: FieldSpot.Second, retired: false },
  ],
}

/**
 * The commit/waiting view of the showcase scenario, built by naming only the
 * non-secret fields — the derived object literally has no `pitch`/`swing` slot
 * to leak a number through (secret-state law, ADR-0014).
 */
export const SHOWCASE_SITUATION = {
  pitcher: SHOWCASE_SCENARIO.pitcher,
  batter: SHOWCASE_SCENARIO.batter,
  clubs: SHOWCASE_SCENARIO.clubs,
  inning: SHOWCASE_SCENARIO.inning,
  half: SHOWCASE_SCENARIO.half,
  outs: SHOWCASE_SCENARIO.outs,
  scoreBefore: SHOWCASE_SCENARIO.scoreBefore,
  hitsBefore: SHOWCASE_SCENARIO.hitsBefore,
  // Mirrors the scenario's movements: the runner the double scores starts on 2nd.
  runnersOn: [FieldSpot.Second],
} satisfies DuelSituation
