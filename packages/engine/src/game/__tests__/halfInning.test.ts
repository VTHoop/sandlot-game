import { describe, expect, it } from 'vitest'
import { halfInning } from '../halfInning'
import { type GameContext, Half } from '../state'

const CONTEXT: GameContext = {
  home: { battingOrder: ['H1', 'H2'], pitcher: 'HP' },
  away: { battingOrder: ['A1', 'A2'], pitcher: 'AP' },
}

describe('halfInning — offense/defense perspective', () => {
  it('puts the away team at bat against the home pitcher in the top half', () => {
    expect(halfInning(Half.Top, CONTEXT)).toEqual({
      battingIsHome: false,
      battingTeam: CONTEXT.away,
      fieldingTeam: CONTEXT.home,
    })
  })

  it('puts the home team at bat against the away pitcher in the bottom half', () => {
    expect(halfInning(Half.Bottom, CONTEXT)).toEqual({
      battingIsHome: true,
      battingTeam: CONTEXT.home,
      fieldingTeam: CONTEXT.away,
    })
  })
})
