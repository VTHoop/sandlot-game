import { describe, expect, it } from 'vitest'
import { deriveDrama, FieldSpot, formatInning, type RevealScenario } from './scenario'

const base: RevealScenario = {
  you: 472,
  them: 519,
  opponent: 'Maddie',
  outcome: '2B',
  inning: 8,
  half: 'BOTTOM',
  outs: 2,
  runsScored: 1,
  scoreBefore: { you: 4, opp: 4 },
  hitsBefore: { you: 7, opp: 6 },
  scoreline: 'Your runner scores from 2nd',
  headline: 'DOUBLE!',
  movements: [
    { from: FieldSpot.Second, to: FieldSpot.Home, retired: false },
    { from: FieldSpot.Batter, to: FieldSpot.Second, retired: false },
  ],
}

describe('deriveDrama', () => {
  it('stacks RBI + lead change + late-and-close on the showcase scenario', () => {
    const drama = deriveDrama(base)
    expect(drama.tags).toMatchObject({
      rbi: true,
      leadChange: true,
      lateAndClose: true,
      walkOff: false,
      newTie: false,
    })
    expect(drama.callout).toBe('LEAD CHANGE — YOU LEAD 5–4')
    // 1.0 outcome base + (0.5 lead change + 0.4 late-close + 0.2 rbi)
    expect(drama.hold).toBeCloseTo(2.1)
  })

  it('treats a routine early-game out as no-drama', () => {
    const drama = deriveDrama({
      ...base,
      outcome: 'GB',
      runsScored: 0,
      inning: 3,
      scoreBefore: { you: 0, opp: 5 },
    })
    expect(drama.callout).toBeNull()
    expect(drama.hold).toBeCloseTo(0.6)
  })

  it('names a walk-off above everything else', () => {
    const drama = deriveDrama({ ...base, inning: 9, outcome: '1B' })
    expect(drama.tags.walkOff).toBe(true)
    expect(drama.callout).toBe('WALK-OFF WIN!')
  })

  it('caps stacked situational boost', () => {
    const drama = deriveDrama({ ...base, inning: 9, outcome: 'HR' })
    // 1.5 HR base + capped 1.2 boost (walk-off + lead change + late-close + rbi = 2.0 uncapped)
    expect(drama.hold).toBeCloseTo(2.7)
  })

  it('calls out a new tie', () => {
    const drama = deriveDrama({ ...base, scoreBefore: { you: 3, opp: 4 } })
    expect(drama.tags.newTie).toBe(true)
    expect(drama.callout).toBe('ALL TIED AT 4')
  })

  it('a strikeout can still be late-and-close drama without a callout', () => {
    const drama = deriveDrama({ ...base, outcome: 'K', runsScored: 0 })
    expect(drama.callout).toBeNull()
    expect(drama.hold).toBeCloseTo(1.2 + 0.4)
  })
})

describe('formatInning', () => {
  it.each([
    [{ inning: 8, half: 'BOTTOM' } as const, 'BOT 8TH'],
    [{ inning: 1, half: 'TOP' } as const, 'TOP 1ST'],
    [{ inning: 12, half: 'BOTTOM' } as const, 'BOT 12TH'],
  ])('%o → %s', (input, expected) => {
    expect(formatInning(input)).toBe(expected)
  })
})
