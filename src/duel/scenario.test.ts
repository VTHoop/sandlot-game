import { REGULATION_INNINGS } from '@sandlot/engine/game'
import { describe, expect, it } from 'vitest'
import { clubLabel, deriveDrama, FieldSpot, formatInning, type RevealScenario } from './scenario'

// A bottom-half at-bat, so the HOME club (RID) is batting: a tie game in the last
// regulation inning but one, a runner scoring on a double.
const base: RevealScenario = {
  pitch: 519,
  swing: 472,
  pitcher: 'G. PIKE',
  batter: 'J. WHITLOCK',
  clubs: { away: 'HAR', home: 'RID' },
  outcome: '2B',
  inning: REGULATION_INNINGS - 1,
  half: 'BOTTOM',
  outs: 2,
  runsScored: 1,
  scoreBefore: { away: 4, home: 4 },
  hitsBefore: { away: 6, home: 7 },
  scoreline: '1 run scores · J. WHITLOCK stands on 2nd',
  headline: 'DOUBLE!',
  movements: [
    { from: FieldSpot.Second, to: FieldSpot.Home, retired: false },
    { from: FieldSpot.Batter, to: FieldSpot.Second, retired: false },
  ],
}

describe('deriveDrama', () => {
  it('stacks RBI + lead change + late-and-close, naming the club that took the lead', () => {
    const drama = deriveDrama(base)
    expect(drama.tags).toMatchObject({
      rbi: true,
      leadChange: true,
      lateAndClose: true,
      walkOff: false,
      newTie: false,
    })
    expect(drama.callout).toBe('LEAD CHANGE — RID LEADS 5–4')
    // 1.0 outcome base + (0.5 lead change + 0.4 late-close + 0.2 rbi)
    expect(drama.hold).toBeCloseTo(2.1)
  })

  it('judges the lead from the batting club — the away club, in the top half', () => {
    // Same tie, top half: the AWAY club bats, so its run is the one that takes the
    // lead and its label is the one the callout names.
    const drama = deriveDrama({ ...base, half: 'TOP' })
    expect(drama.tags.leadChange).toBe(true)
    expect(drama.callout).toBe('LEAD CHANGE — HAR LEADS 5–4')
  })

  it('treats a routine early-game out as no-drama', () => {
    const drama = deriveDrama({
      ...base,
      outcome: 'GB',
      runsScored: 0,
      inning: 1,
      scoreBefore: { away: 5, home: 0 },
    })
    expect(drama.callout).toBeNull()
    expect(drama.hold).toBeCloseTo(0.6)
  })

  it('names a walk-off above everything else, in the last regulation inning', () => {
    // Regulation is the engine's to define (six innings), so the walk-off inning is
    // read off its constant rather than a nine-inning assumption.
    const drama = deriveDrama({ ...base, inning: REGULATION_INNINGS, outcome: '1B' })
    expect(drama.tags.walkOff).toBe(true)
    expect(drama.callout).toBe('WALK-OFF!')
  })

  it('still names a walk-off in extra innings', () => {
    const drama = deriveDrama({ ...base, inning: REGULATION_INNINGS + 2, outcome: '1B' })
    expect(drama.tags.walkOff).toBe(true)
  })

  it('never calls a top-half go-ahead run a walk-off — the home club still bats', () => {
    const drama = deriveDrama({ ...base, half: 'TOP', inning: REGULATION_INNINGS })
    expect(drama.tags.walkOff).toBe(false)
  })

  it('is not late-and-close before the last two regulation innings', () => {
    const drama = deriveDrama({ ...base, inning: REGULATION_INNINGS - 2 })
    expect(drama.tags.lateAndClose).toBe(false)
  })

  it('caps stacked situational boost', () => {
    const drama = deriveDrama({ ...base, inning: REGULATION_INNINGS, outcome: 'HR' })
    // 1.5 HR base + capped 1.2 boost (walk-off + lead change + late-close + rbi = 2.0 uncapped)
    expect(drama.hold).toBeCloseTo(2.7)
  })

  it('calls out a new tie', () => {
    const drama = deriveDrama({ ...base, scoreBefore: { away: 4, home: 3 } })
    expect(drama.tags.newTie).toBe(true)
    expect(drama.callout).toBe('ALL TIED AT 4')
  })

  it('a strikeout can still be late-and-close drama without a callout', () => {
    const drama = deriveDrama({ ...base, outcome: 'K', runsScored: 0 })
    expect(drama.callout).toBeNull()
    expect(drama.hold).toBeCloseTo(1.2 + 0.4)
  })
})

describe('clubLabel', () => {
  it.each([
    ['Ridgeview Rail', 'RID'],
    ['Harbor Kingfishers', 'HAR'],
    ['El Paso Suns', 'ELP'],
    ['Oz', 'OZ'],
  ])('%s → %s', (name, expected) => {
    expect(clubLabel(name)).toBe(expected)
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
