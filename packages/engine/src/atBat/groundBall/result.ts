/**
 * The ground-ball sub-results the GB band resolves into (SAN-16, rules §2.9–2.15).
 *
 * The persisted `outcomeBand` stays `GB`; this finer taxonomy is recorded
 * alongside it as a nullable `groundBallResult` (null for non-GB outcomes). A TS
 * enum (not a bare string union) because this is a finite internal value set the
 * engine owns; the Convex validator mirrors these literals with a compile-time
 * guard, the same way `outcomeBand` mirrors `OUTCOME_BAND_KEYS`.
 */
export enum GroundBallResult {
  /** Bases empty: batter out at 1st, no runner movement. */
  GO = 'GO',
  /** Out at 1st, all runners advance one base (a run scores from 3rd). */
  GO_RA = 'GO_RA',
  /** Runner from 1st out at 2nd, batter safe at 1st, lead runners hold. */
  FC = 'FC',
  /** Runner from 1st out at 2nd, batter safe, the runner ahead advances/scores. */
  FC_2ND = 'FC_2ND',
  /** Runner from 2nd out at 3rd, runner from 1st and batter safe. */
  FC_3RD = 'FC_3RD',
  /** Runner from 3rd out at home, every other runner and the batter advance. */
  FC_HOME = 'FC_HOME',
  /** Batter and the lead forced runner both out (needs a force, < 2 outs). */
  DP = 'DP',
  /** Three outs (needs a force at every base in play, 0 outs, top of the band). */
  TP = 'TP',
}
