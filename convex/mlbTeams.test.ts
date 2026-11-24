// @vitest-environment edge-runtime
/// <reference types="vite/client" />

import { convexTest } from 'convex-test'
import { describe, expect, it } from 'vitest'
import { api } from './_generated/api'
import type { Doc } from './_generated/dataModel'
import { eligibleMlbTeams } from './mlbTeams'
import schema from './schema'

/**
 * The real MLB teams a player can pick (SAN-77). Every team and player is
 * fictional — no real names or stats (ADR-0006).
 */

const modules = import.meta.glob(['./**/*.ts', '!./**/*.test.ts'])

const HITTER_SLOTS = ['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'DH'] as const
const HITTER_ATTRS = { power: 3, contact: 3, speed: 3, eye: 3 } as const
const ARM_ATTRS = { velocity: 3, movement: 3, awareness: 3, command: 3 } as const

type NewPlayer = Omit<Doc<'players'>, '_id' | '_creationTime'>

let nextId = 1000
const hitterAt = (position: (typeof HITTER_SLOTS)[number], mlbTeam?: string): NewPlayer => ({
  name: `Hitter ${nextId}`,
  source: 'mlb',
  role: 'hitter',
  position,
  price: null,
  attributes: HITTER_ATTRS,
  mlbId: nextId++,
  ...(mlbTeam === undefined ? {} : { mlbTeam }),
})
const arm = (mlbTeam?: string): NewPlayer => ({
  name: `Arm ${nextId}`,
  source: 'mlb',
  role: 'pitcher',
  position: 'P',
  price: null,
  attributes: ARM_ATTRS,
  mlbId: nextId++,
  ...(mlbTeam === undefined ? {} : { mlbTeam }),
})

/** A team with every slot filled and one pitcher. */
const fullTeam = (team: string): NewPlayer[] => [
  ...HITTER_SLOTS.map((slot) => hitterAt(slot, team)),
  arm(team),
]

const doc = (player: NewPlayer): Doc<'players'> => ({
  ...player,
  _id: `p${player.mlbId}` as Doc<'players'>['_id'],
  _creationTime: 0,
})
const names = (players: NewPlayer[]) => eligibleMlbTeams(players.map(doc))

describe('eligibleMlbTeams', () => {
  it('lists a team with a hitter at every slot and a pitcher', () => {
    expect(names(fullTeam('Harbor Gulls'))).toEqual(['Harbor Gulls'])
  })

  it.each(HITTER_SLOTS)('drops a team with nobody at %s', (missing) => {
    const players = fullTeam('Harbor Gulls').filter((p) => p.position !== missing)
    expect(names(players)).toEqual([])
  })

  it('drops a team with no pitcher', () => {
    expect(names(fullTeam('Harbor Gulls').filter((p) => p.role !== 'pitcher'))).toEqual([])
  })

  it('does not let several players at one position fill another slot', () => {
    const players = [
      ...fullTeam('Harbor Gulls').filter((p) => p.position !== 'SS'),
      hitterAt('CF', 'Harbor Gulls'),
      hitterAt('CF', 'Harbor Gulls'),
    ]
    expect(names(players)).toEqual([])
  })

  it('counts a two-way player through his DH hitter row and his pitcher row', () => {
    const twoWay = { ...hitterAt('DH', 'Harbor Gulls'), mlbId: 77 }
    const twoWayArm = { ...arm('Harbor Gulls'), mlbId: 77 }
    const players = [
      ...fullTeam('Harbor Gulls').filter((p) => p.position !== 'DH' && p.role !== 'pitcher'),
      twoWay,
      twoWayArm,
    ]
    expect(names(players)).toEqual(['Harbor Gulls'])
  })

  it('counts neither teamless players nor other sources toward a team', () => {
    const players = [
      ...fullTeam('Harbor Gulls').filter((p) => p.position !== 'SS'),
      { ...hitterAt('SS', 'Harbor Gulls'), source: 'custom' as const },
      hitterAt('SS'),
    ]
    expect(names(players)).toEqual([])
  })

  it('sorts team names alphabetically', () => {
    const players = [
      ...fullTeam('Prairie Owls'),
      ...fullTeam('Dune Foxes'),
      ...fullTeam('Lake Herons'),
    ]
    expect(names(players)).toEqual(['Dune Foxes', 'Lake Herons', 'Prairie Owls'])
  })
})

describe('mlbTeams.listMlbTeams', () => {
  const SIGNED_IN = { subject: 'signed-in' }

  async function seeded() {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      await ctx.db.insert('users', { clerkSubject: SIGNED_IN.subject, displayName: 'kid' })
      for (const player of [...fullTeam('Prairie Owls'), ...fullTeam('Dune Foxes')]) {
        await ctx.db.insert('players', player)
      }
    })
    return t
  }

  it('gives a signed-in user the team names only, sorted', async () => {
    const t = await seeded()
    expect(await t.withIdentity(SIGNED_IN).query(api.mlbTeams.listMlbTeams, {})).toEqual([
      { name: 'Dune Foxes' },
      { name: 'Prairie Owls' },
    ])
  })

  it('gives an unauthenticated caller an empty list', async () => {
    const t = await seeded()
    expect(await t.query(api.mlbTeams.listMlbTeams, {})).toEqual([])
  })

  it('gives an identity with no users row an empty list', async () => {
    const t = await seeded()
    expect(
      await t.withIdentity({ subject: 'stranger' }).query(api.mlbTeams.listMlbTeams, {}),
    ).toEqual([])
  })
})
