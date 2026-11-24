import { describe, expect, it } from 'vitest'
import type { Doc } from './_generated/dataModel'
import { buildLineup } from './lineup'
import { HITTER_SLOT_LIST } from './seasonPlayers'

/**
 * The lineup builder (SAN-78). Every team and player is fictional — no real names
 * or stats (ADR-0006).
 */

type Slot = (typeof HITTER_SLOT_LIST)[number]
type Ratings = { power: 1 | 2 | 3 | 4 | 5; contact: 1 | 2 | 3 | 4 | 5 } & Partial<{
  speed: 1 | 2 | 3 | 4 | 5
  eye: 1 | 2 | 3 | 4 | 5
}>

const TEAM = 'Harbor Gulls'

let seq = 0
const idOf = (label: string) => `${label}` as Doc<'players'>['_id']

const hitter = (
  id: string,
  position: Slot,
  plateAppearances: number | undefined,
  ratings: Ratings = { power: 3, contact: 3 },
  mlbTeam: string | undefined = TEAM,
): Doc<'players'> => ({
  _id: idOf(id),
  _creationTime: seq++,
  name: id,
  source: 'mlb',
  role: 'hitter',
  position,
  price: null,
  attributes: { speed: 3, eye: 3, ...ratings },
  mlbId: seq,
  ...(mlbTeam === undefined ? {} : { mlbTeam }),
  ...(plateAppearances === undefined ? {} : { plateAppearances }),
})

const arm = (id: string, outs: number | undefined, mlbTeam: string = TEAM): Doc<'players'> => ({
  _id: idOf(id),
  _creationTime: seq++,
  name: id,
  source: 'mlb',
  role: 'pitcher',
  position: 'P',
  price: null,
  attributes: { velocity: 3, movement: 3, awareness: 3, command: 3 },
  mlbId: seq,
  mlbTeam,
  ...(outs === undefined ? {} : { outs }),
})

/** One regular per slot (PA 500) and one starter (outs 400). */
const regulars = (): Doc<'players'>[] => [
  ...HITTER_SLOT_LIST.map((slot) => hitter(`reg-${slot}`, slot, 500)),
  arm('ace', 400),
]

const slotOf = (lineup: ReturnType<typeof buildLineup>, id: string) =>
  lineup.battingOrder.find((slot) => slot.player === id)?.position

describe('buildLineup refuses what listMlbTeams would not offer', () => {
  it('throws for a team no player belongs to', () => {
    expect(() => buildLineup('Nowhere Nine', regulars())).toThrow(/Nowhere Nine/)
  })

  it.each(HITTER_SLOT_LIST)('throws for a team with no hitter at %s', (slot) => {
    const players = regulars().filter((p) => p.position !== slot)
    expect(() => buildLineup(TEAM, players)).toThrow(/not offered/)
  })

  it('throws for a team with no pitcher', () => {
    const players = regulars().filter((p) => p.role !== 'pitcher')
    expect(() => buildLineup(TEAM, players)).toThrow(/not offered/)
  })

  it('throws for a team whose players are not source mlb', () => {
    const players = regulars().map((p) => ({ ...p, source: 'custom' as const }))
    expect(() => buildLineup(TEAM, players)).toThrow(/not offered/)
  })
})

describe('buildLineup picks regulars by playing time', () => {
  it('takes, at each position, the hitter with the most plate appearances', () => {
    const players = [...regulars(), hitter('bench-SS', 'SS', 120), hitter('star-SS', 'SS', 640)]
    const lineup = buildLineup(TEAM, players)
    expect(slotOf(lineup, 'star-SS')).toBe('SS')
    expect(slotOf(lineup, 'reg-SS')).toBeUndefined()
    expect(slotOf(lineup, 'bench-SS')).toBeUndefined()
  })

  it('takes the pitcher with the most outs recorded as the starter', () => {
    const lineup = buildLineup(TEAM, [...regulars(), arm('reliever', 90), arm('workhorse', 560)])
    expect(lineup.pitcher).toBe('workhorse')
  })

  it('breaks a plate-appearance tie at a position by player id', () => {
    const players = [...regulars(), hitter('aaa-C', 'C', 500), hitter('zzz-C', 'C', 500)]
    expect(slotOf(buildLineup(TEAM, players), 'aaa-C')).toBe('C')
  })

  it('breaks an outs tie between pitchers by player id', () => {
    const lineup = buildLineup(TEAM, [...regulars(), arm('aaa-arm', 400), arm('zzz-arm', 400)])
    expect(lineup.pitcher).toBe('aaa-arm')
  })

  it('ignores another team’s players', () => {
    const players = [...regulars(), hitter('rival-SS', 'SS', 700, undefined, 'Dune Foxes')]
    expect(slotOf(buildLineup(TEAM, players), 'rival-SS')).toBeUndefined()
  })

  it('refuses a chosen player with no recorded playing time rather than guess', () => {
    const players = [
      ...regulars().filter((p) => p._id !== 'reg-SS'),
      hitter('reg-SS', 'SS', undefined),
    ]
    expect(() => buildLineup(TEAM, players)).toThrow(/normalize/)
  })
})

describe('buildLineup batting order', () => {
  const slotsByOrder = (lineup: ReturnType<typeof buildLineup>) =>
    lineup.battingOrder.map((slot) => slot.player)

  it('puts the highest sum of the four hitter ratings first', () => {
    const players = [
      ...regulars().filter((p) => p.position !== 'RF' && p.position !== '1B'),
      hitter('slugger', 'RF', 500, { power: 5, contact: 5, speed: 4, eye: 4 }),
      hitter('slap', '1B', 500, { power: 1, contact: 2, speed: 1, eye: 1 }),
    ]
    const order = slotsByOrder(buildLineup(TEAM, players))
    expect(order[0]).toBe('slugger')
    expect(order[8]).toBe('slap')
  })

  it('breaks a rating tie by plate appearances, then by player id', () => {
    const tied = { power: 5, contact: 5, speed: 5, eye: 5 } as const
    const players = [
      ...regulars().filter((p) => !['LF', 'CF', 'RF'].includes(p.position)),
      hitter('zzz-LF', 'LF', 400, tied),
      hitter('mmm-CF', 'CF', 600, tied),
      hitter('bbb-RF', 'RF', 400, tied),
    ]
    expect(slotsByOrder(buildLineup(TEAM, players)).slice(0, 3)).toEqual([
      'mmm-CF',
      'bbb-RF',
      'zzz-LF',
    ])
  })
})

describe('buildLineup returns the lineups shape', () => {
  it('is nine { player, position } entries, one per slot, plus a pitcher', () => {
    const lineup = buildLineup(TEAM, regulars())
    expect(lineup.battingOrder).toHaveLength(9)
    expect(lineup.battingOrder.map((slot) => slot.position).sort()).toEqual(
      [...HITTER_SLOT_LIST].sort(),
    )
    expect(lineup.pitcher).toBe('ace')
  })

  it('never lists a player twice, even a two-way player who also pitches', () => {
    const twoWay = { ...arm('twp', 999), _id: idOf('twp-arm') }
    const players = [...regulars(), hitter('twp', 'DH', 900), twoWay]
    const lineup = buildLineup(TEAM, players)
    const ids = [...lineup.battingOrder.map((slot) => slot.player), lineup.pitcher]
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('buildLineup is deterministic whatever order the players arrive in', () => {
  /** A small seeded generator so the shuffles are reproducible. */
  function rng(seed: number) {
    let state = seed
    return () => {
      state = (state * 1664525 + 1013904223) % 4294967296
      return state / 4294967296
    }
  }
  const shuffled = <T>(items: readonly T[], next: () => number): T[] => {
    const out = [...items]
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(next() * (i + 1))
      const held = out[i] as T
      out[i] = out[j] as T
      out[j] = held
    }
    return out
  }

  it('returns the same lineup for 200 shuffles of a field full of ties', () => {
    const tied = { power: 4, contact: 4, speed: 2, eye: 2 } as const
    const field = [
      ...HITTER_SLOT_LIST.flatMap((slot) => [
        hitter(`a-${slot}`, slot, 500, tied),
        hitter(`b-${slot}`, slot, 500, tied),
        hitter(`c-${slot}`, slot, 350, tied),
      ]),
      arm('arm-a', 400),
      arm('arm-b', 400),
      arm('arm-c', 200),
    ]
    const expected = buildLineup(TEAM, field)
    const next = rng(7)
    for (let run = 0; run < 200; run++) {
      expect(buildLineup(TEAM, shuffled(field, next))).toEqual(expected)
    }
  })
})
