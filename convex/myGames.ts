import type { GameStatus, Half } from '@sandlot/engine/game'
import type { Id } from './_generated/dataModel'
import { query } from './_generated/server'
import type { ClubTotals, ClubView } from './gameView'
import type { ClubOwnership } from './participants'

/** The fields every row carries, whatever the game's status. */
interface GameListCommon {
  id: Id<'games'>
  home: ClubView
  away: ClubView
  viewerOwns: ClubOwnership
}

/** One row of the viewer's game list (SAN-72). */
export type GameListEntry =
  | (GameListCommon & { status: GameStatus.Scheduled })
  | (GameListCommon & {
      status: GameStatus.Live
      inning: number
      half: Half
      score: ClubTotals
      yourMove: boolean
    })
  | (GameListCommon & { status: GameStatus.Final; score: ClubTotals })

/** Stub — declared so the red suite typechecks. */
export const listMyGames = query({
  args: {},
  handler: async (): Promise<GameListEntry[]> => [],
})
