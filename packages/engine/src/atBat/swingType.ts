/**
 * The batter's swing declaration (SAN-17, Rules §3.4). A bunt is a single
 * declaration made when the batter submits their number — the player does NOT
 * pre-choose sacrifice vs bunt-for-hit; the outcome family emerges from the folded
 * difference + base state in the bunt sub-resolution.
 *
 * A TS enum (not a bare string union) because this is a finite internal value set
 * the engine owns; the Convex validator mirrors these literals with a compile-time
 * guard, the same way `outcomeBand` mirrors `OUTCOME_BAND_KEYS`. `ResolveInput`
 * carries it as an optional field defaulting to `Normal`, so existing callers (and
 * the at-bat UI, out of SAN-17 scope) are undisturbed.
 */
export enum SwingType {
  /** A normal swing — resolved through the RangeFinder outcome-band stack. */
  Normal = 'normal',
  /** A bunt — resolved through the bunt sub-resolution, bypassing the band stack. */
  Bunt = 'bunt',
}
