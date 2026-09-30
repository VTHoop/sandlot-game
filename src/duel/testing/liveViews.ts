import { GameStatus, Half } from '@sandlot/engine/game'
import type { Id } from '../../../convex/_generated/dataModel'
import type { ResolvedAtBatView } from '../../../convex/duelContract'
import { ClubSide, type GameView, SeatRole } from '../../../convex/gameView'
import type { LiveGameView } from '../liveDuel'

/**
 * Server views for tests: what `getGame` and `getLastAtBat` would hand a client,
 * built by hand so a test states only the fields it is about. Test support — not
 * imported by the app.
 */

export const player = (id: string, name: string) => ({ id: id as Id<'players'>, name })

export const GAME_ID = 'game-1' as Id<'games'>

/** The two clubs every view here is between. */
export const CLUBS = {
  home: { id: 'home-club' as Id<'teams'>, name: 'Ridgeview Rail' },
  away: { id: 'away-club' as Id<'teams'>, name: 'Harbor Kingfishers' },
} satisfies Pick<GameView, 'home' | 'away'>

export const owns = (home: boolean, away: boolean) => ({ home, away })

export const locks = (pitchCommitted: boolean, swingCommitted: boolean) => ({
  pitchCommitted,
  swingCommitted,
})

/**
 * A live top-half situation, read by the AWAY owner: Harbor bats (R. VANCE)
 * against Ridgeview's H. MARSH, one out, T. JULIEN on second.
 */
export function liveView(overrides: Partial<LiveGameView> = {}): LiveGameView {
  return {
    id: GAME_ID,
    status: GameStatus.Live,
    ...CLUBS,
    viewer: ClubSide.Away,
    viewerOwns: owns(false, true),
    viewerSeat: SeatRole.Batting,
    inning: 3,
    half: Half.Top,
    outs: 1,
    bases: { first: null, second: player('r2', 'T. JULIEN'), third: null },
    score: { home: 2, away: 1 },
    hits: { home: 5, away: 4 },
    batter: { ...player('b1', 'R. VANCE'), attributes: { power: 3, contact: 4, speed: 3, eye: 5 } },
    pitcher: {
      ...player('p1', 'H. MARSH'),
      attributes: { velocity: 3, movement: 4, awareness: 3, command: 2 },
    },
    dueUp: [player('d1', 'S. ORTIZ'), player('d2', 'C. DIAZ')],
    locks: locks(false, false),
    ...overrides,
  }
}

/** A run-scoring double in the bottom of the 3rd: the runner on 2nd scores. */
export function resolvedAtBat(overrides: Partial<ResolvedAtBatView> = {}): ResolvedAtBatView {
  return {
    sequence: 7,
    inning: 3,
    half: Half.Bottom,
    pitcher: player('p2', 'G. PIKE'),
    batter: player('b2', 'J. WHITLOCK'),
    pitchNumber: 519,
    batterNumber: 472,
    outcome: '2B',
    groundBallResult: null,
    runsScored: 1,
    outsBefore: 1,
    outsAfter: 1,
    basesBefore: { first: null, second: 'r9', third: null },
    basesAfter: { first: null, second: 'b2', third: null },
    scoreBefore: { home: 2, away: 3 },
    hitsBefore: { home: 5, away: 6 },
    endedHalf: false,
    halfTotals: { runs: 1, hits: 2 },
    ...overrides,
  }
}
