import { describe, expect, it } from 'vitest'
import { REVEAL_TEMPO, revealBeats } from './revealTiming'
import { FieldSpot, type RevealScenario } from './scenario'

const scenario = (overrides: Partial<RevealScenario> = {}): RevealScenario => ({
  you: 400,
  them: 500,
  opponent: 'ARM',
  outcome: 'HR',
  inning: 7,
  half: 'BOTTOM',
  outs: 1,
  runsScored: 4,
  scoreBefore: { you: 2, opp: 5 },
  hitsBefore: { you: 4, opp: 6 },
  scoreline: 'grand slam',
  headline: 'HOME RUN!',
  movements: [
    { from: FieldSpot.Batter, to: FieldSpot.Home, retired: false },
    { from: FieldSpot.First, to: FieldSpot.Home, retired: false },
  ],
  ...overrides,
})

describe('reveal tempo', () => {
  it('plays the whole beat slower by exactly the tempo, nothing left behind', () => {
    // Testers said the reveal read fast. Slowing it must stretch EVERY part of the
    // choreography — a beat that keeps its old duration would desynchronise.
    const raw = revealBeats(scenario(), 1)
    const played = revealBeats(scenario(), REVEAL_TEMPO)
    const keys = Object.keys(raw) as (keyof typeof raw)[]
    expect(keys.length).toBeGreaterThan(4)
    for (const key of keys) {
      expect(played[key]).toBeCloseTo(raw[key] * REVEAL_TEMPO)
    }
  })

  it('keeps every beat in the same proportion to every other', () => {
    const raw = revealBeats(scenario(), 1)
    const played = revealBeats(scenario(), REVEAL_TEMPO)
    expect(played.runnersAt / played.fieldAt).toBeCloseTo(raw.runnersAt / raw.fieldAt)
    expect(played.scorelineAt / played.outcomeAt).toBeCloseTo(raw.scorelineAt / raw.outcomeAt)
  })

  it('runs at 1.5x — the pace chosen from tester feedback', () => {
    expect(REVEAL_TEMPO).toBe(1.5)
  })

  it('still resolves the beats in choreography order', () => {
    const b = revealBeats(scenario())
    expect(b.outcomeAt).toBeLessThan(b.fieldAt)
    expect(b.fieldAt).toBeLessThan(b.ballAt)
    expect(b.ballAt).toBeLessThan(b.runnersAt)
    expect(b.runnersAt).toBeLessThan(b.runTickAt)
    expect(b.runTickAt).toBeLessThan(b.scorelineAt)
  })
})
