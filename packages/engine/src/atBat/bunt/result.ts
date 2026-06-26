/**
 * The bunt sub-results a bunt declaration resolves into (SAN-17, Rules §3.4 +
 * the workbook Bunts tab).
 *
 * A bunt bypasses the RangeFinder; its outcome family emerges from the single
 * folded difference + base state. The persisted `outcomeBand` maps onto a
 * representative existing band (bunt-hit / butcher-boy → `1B`; a successful sac →
 * `FO`; dud / DP / TP → `GB`), and this finer taxonomy is recorded alongside it as
 * a nullable `buntResult` (null for a normal swing) — the same single-source-of-
 * truth discipline as `groundBallResult` (ADR-0019/ADR-0021). A TS enum because it
 * is a finite internal value set the engine owns; the Convex validator mirrors it.
 *
 * Failed sacrifices are not split into SAFE/OUT variants — they collapse into
 * `DUD`, matching the workbook's actual families (Sac 2nd/3rd/Home, Bunt Hit, Dud).
 */
export enum BuntResult {
  /** Triple play — a force out available at every base in play, 0 outs (top tail). */
  TP = 'TP',
  /** Double play — the TP-not-possible fallback in the top tail (lead runner + batter). */
  DP = 'DP',
  /** Butcher boy (0–3 diff): batter awarded a single, every runner advances an extra base. */
  BUTCHER_BOY = 'BUTCHER_BOY',
  /** Successful sacrifice, lead runner on 1st: runner to 2nd, batter out. */
  SAC_2ND = 'SAC_2ND',
  /** Successful sacrifice, lead runner on 2nd: runner to 3rd (1st→2nd), batter out. */
  SAC_3RD = 'SAC_3RD',
  /** Successful sacrifice, lead runner on 3rd: runner scores, others advance, batter out. */
  SAC_HOME = 'SAC_HOME',
  /** Bunt for a hit: batter safe at first, runners advance one base. */
  BUNT_HIT = 'BUNT_HIT',
  /** Failed bunt: batter out, no runner advances. */
  DUD = 'DUD',
}
