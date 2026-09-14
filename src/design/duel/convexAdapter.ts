import type { DuelCommitResult, DuelRejection, DuelView } from '../../../convex/duelContract'
import type { GameView } from '../../../convex/gameView'
import type { DuelAdapter, DuelResolution, HitTotals } from './adapter'
import type { DuelMatchup } from './MatchupCard'
import type { Roster } from './roster'

/**
 * The Convex-backed duel adapter (SAN-57) — stubbed. See the red checkpoint's
 * commit message: the contract is declared so the failing suite compiles.
 */

/** The Convex surface one duel needs, with the game id already bound. */
export interface DuelGateway {
  readGame(): Promise<GameView | null>
  readDuel(): Promise<DuelView | null>
  commitPitch(number: number): Promise<DuelCommitResult>
  commitSwing(number: number): Promise<DuelCommitResult>
}

/** A commit the server refused, carrying the category it refused with. */
export class DuelCommitError extends Error {
  readonly rejection: DuelRejection

  constructor(rejection: DuelRejection, reason: string) {
    super(reason)
    this.name = 'DuelCommitError'
    this.rejection = rejection
  }
}

/** The Convex-backed adapter: a `DuelAdapter` plus the two handles a duel screen
 * needs from the boundary that resolved them. */
export interface ConvexDuelAdapter extends DuelAdapter {
  playAtBat(pitch: number, swing: number): Promise<DuelResolution>
  hits(): HitTotals
  /** The live roster handle `playHalfInning` takes. */
  roster(): Roster
  matchup(): DuelMatchup
  /** Re-read the server and install the snapshot. */
  refresh(): Promise<void>
}

export function createConvexDuelAdapter(gateway: DuelGateway): Promise<ConvexDuelAdapter> {
  return Promise.reject(new Error(`not implemented: ${typeof gateway}`))
}
