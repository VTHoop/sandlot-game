import { GameStatus, Half, startGame } from '@sandlot/engine/game'
import { describe, expect, it } from 'vitest'
import { AWAY_LINEUP, GAME_CONTEXT, HOME_LINEUP, ROSTER, type RosterPlayer } from './roster'

const isRating = (n: number): boolean => Number.isInteger(n) && n >= 1 && n <= 5

function ratingsOf(player: RosterPlayer): number[] {
  return Object.values(player.attributes)
}

describe('synthetic roster', () => {
  it('maps each id to a name, a single role block, and a base-running speed', () => {
    const leadoff = ROSTER.get('away-1')
    expect(leadoff).toEqual({
      name: 'R. VANCE',
      attributes: { power: 3, contact: 3, speed: 3, eye: 5 },
      speed: 3,
    })
    const pitcher = ROSTER.get('home-p')
    expect(pitcher).toEqual({
      name: 'H. MARSH',
      attributes: { velocity: 3, movement: 3, awareness: 3, command: 1 },
      speed: 1,
    })
  })

  it('carries only 1–5 attribute ratings (synthetic, no MLB data)', () => {
    for (const player of ROSTER.values()) {
      for (const rating of ratingsOf(player)) {
        expect(isRating(rating)).toBe(true)
      }
    }
  })

  it('seats every lineup slot — batters as hitters, pitchers as pitchers', () => {
    for (const lineup of [AWAY_LINEUP, HOME_LINEUP]) {
      for (const id of lineup.battingOrder) {
        const player = ROSTER.get(id)
        expect(player).toBeDefined()
        expect('power' in (player as RosterPlayer).attributes).toBe(true)
      }
      const pitcher = ROSTER.get(lineup.pitcher)
      expect(pitcher).toBeDefined()
      expect('velocity' in (pitcher as RosterPlayer).attributes).toBe(true)
    }
  })
})

describe('GAME_CONTEXT', () => {
  it('composes both lineups into a context startGame accepts', () => {
    const state = startGame(GAME_CONTEXT)
    expect(state.status).toBe(GameStatus.Live)
    expect(state.half).toBe(Half.Top)
    expect(state.inning).toBe(1)
    // Away ("you") leads off the top; the home pitcher takes the mound.
    expect(state.currentBatter).toBe('away-1')
    expect(state.currentPitcher).toBe('home-p')
  })
})
