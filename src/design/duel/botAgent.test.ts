import { DUEL_MAX, DUEL_MIN, isDuelNumber } from '@sandlot/engine/atBat'
import { describe, expect, it } from 'vitest'
import { createBotAgent } from './botAgent'
import type { DuelSituation } from './scenario'
import { DuelSeat, type SeatCommitRequest } from './seatAgent'

// A non-secret situation: the exact shape the seam hands a seat agent — it
// structurally excludes both duel numbers, so a bot can carry no secret.
const SITUATION: DuelSituation = {
  opponent: 'ARM',
  inning: 1,
  half: 'TOP',
  outs: 0,
  scoreBefore: { you: 0, opp: 0 },
  hitsBefore: { you: 0, opp: 0 },
  runnersOn: [],
}
const request = (seat: DuelSeat): SeatCommitRequest => ({ seat, situation: SITUATION })

describe('createBotAgent', () => {
  it('emits a valid duel number for every draw across the rng contract range', async () => {
    // Sweep the half-open unit interval [0, 1) the rng contract guarantees.
    for (let i = 0; i < 1000; i += 1) {
      const bot = createBotAgent(() => i / 1000)
      const n = await bot.requestNumber(request(DuelSeat.Pitcher))
      expect(isDuelNumber(n)).toBe(true)
    }
  })

  it('spans the whole [DUEL_MIN, DUEL_MAX] range at the rng bounds', async () => {
    const low = await createBotAgent(() => 0).requestNumber(request(DuelSeat.Pitcher))
    const high = await createBotAgent(() => 1 - Number.EPSILON).requestNumber(
      request(DuelSeat.Batter),
    )
    expect(low).toBe(DUEL_MIN)
    expect(high).toBe(DUEL_MAX)
  })

  it('only ever emits valid duel numbers under the real (Math.random) rng', async () => {
    const bot = createBotAgent()
    for (let i = 0; i < 5000; i += 1) {
      const n = await bot.requestNumber(request(i % 2 === 0 ? DuelSeat.Pitcher : DuelSeat.Batter))
      expect(isDuelNumber(n)).toBe(true)
    }
  })

  it('draws across the full range (uniform baseline), not a narrow band', async () => {
    // With this many draws a uniform generator all but certainly reaches both ends
    // of the range; a stuck/narrow generator would not.
    const bot = createBotAgent()
    let min = DUEL_MAX
    let max = DUEL_MIN
    for (let i = 0; i < 5000; i += 1) {
      const n = await bot.requestNumber(request(DuelSeat.Pitcher))
      min = Math.min(min, n)
      max = Math.max(max, n)
    }
    expect(min).toBeLessThan(DUEL_MIN + 50)
    expect(max).toBeGreaterThan(DUEL_MAX - 50)
  })
})
