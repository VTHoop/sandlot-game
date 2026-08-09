import type { GameStatus, Half } from '@sandlot/engine/game'
import { v } from 'convex/values'
import type { Doc, Id } from './_generated/dataModel'
import { query } from './_generated/server'

/**
 * Secret-safe live game read model (SAN-56) — red checkpoint. The types are
 * declared so the suite compiles; the handler is unimplemented so it fails.
 */

/** Which club of the matchup a value belongs to. */
export enum ClubSide {
  Home = 'home',
  Away = 'away',
}

/** Which seat a club occupies in the at-bat currently on the field. */
export enum SeatRole {
  Batting = 'batting',
  Pitching = 'pitching',
}

/** A club, named. */
export interface ClubView {
  id: Id<'teams'>
  name: string
}

/** Anyone standing on the field: enough to render, never enough to infer a number. */
export interface PlayerView {
  id: Id<'players'>
  name: string
}

/** A seated player plus the attribute block the matchup card reads. */
export interface SeatView extends PlayerView {
  attributes: Doc<'players'>['attributes']
}

/** Who is standing on each base, or null when it is empty. */
export interface BasesView {
  first: PlayerView | null
  second: PlayerView | null
  third: PlayerView | null
}

/** One absolute per-club total — never "you"/"them". */
export interface ClubTotals {
  home: number
  away: number
}

/** Whether each seat has locked, as a boolean per role and never a number. */
export interface LockView {
  pitchCommitted: boolean
  swingCommitted: boolean
}

/** The fields every variant carries, whatever the game's status. */
interface GameViewCommon {
  id: Id<'games'>
  home: ClubView
  away: ClubView
  viewer: ClubSide
}

export type GameView =
  | (GameViewCommon & { status: GameStatus.Scheduled })
  | (GameViewCommon & {
      status: GameStatus.Live
      inning: number
      half: Half
      outs: number
      bases: BasesView
      score: ClubTotals
      hits: ClubTotals
      batter: SeatView
      pitcher: SeatView
      viewerSeat: SeatRole
      locks: LockView
    })
  | (GameViewCommon & {
      status: GameStatus.Final
      score: ClubTotals
      hits: ClubTotals
      winner: ClubSide | null
    })

export const getGame = query({
  args: { game: v.id('games') },
  handler: async (_ctx, _args): Promise<GameView | null> => {
    throw new Error('not implemented')
  },
})
