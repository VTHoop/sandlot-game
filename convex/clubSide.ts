/**
 * Which club of a matchup a value belongs to — the read models' absolute
 * perspective (ADR-0025, ADR-0030).
 *
 * **A leaf module on purpose**, like `duelContract.ts`: it imports nothing, so a
 * browser client can branch on a `ClubSide` without pulling `gameView.ts` — and
 * behind it `_generated/server` — into its bundle. `gameView.ts` re-exports it.
 */
export enum ClubSide {
  Home = 'home',
  Away = 'away',
}
