import { describe, expect, it } from 'vitest'
import schema from './schema'

type ExportedTable = {
  export(): {
    indexes: { indexDescriptor: string; fields: string[] }[]
    documentType: unknown
  }
}
// `export()` is an internal TableDefinition method not in the public type;
// reach it through `unknown` rather than the public surface.
const tables = schema.tables as unknown as Record<string, ExportedTable>

/**
 * Schema-contract test (SAN-19). Locks in the table set, the named indexes (and
 * their fields), and the "no v.any()" guarantee from the AC. Behavioral tests
 * (secret round-trip, append-only enforcement, state machine) are owned by
 * downstream tickets.
 */

// Expected named indexes per table → ordered index fields.
const EXPECTED_INDEXES: Record<string, Record<string, string[]>> = {
  users: { by_clerk_subject: ['clerkSubject'] },
  teams: { by_owner: ['owner'] },
  players: { by_source: ['source'], by_role: ['role'] },
  games: {
    by_status: ['status'],
    by_home_team: ['homeTeam'],
    by_away_team: ['awayTeam'],
  },
  lineups: { by_game: ['game'], by_team: ['team'] },
  pitches: { by_at_bat: ['atBat'] },
  atBats: { by_game: ['game', 'sequence'] },
  standings: { by_team: ['team'] },
  playerStatLine: { by_player: ['player'] },
  boxScoreLine: { by_game: ['game'] },
}

describe('multiplayer schema', () => {
  it('defines exactly the expected tables', () => {
    expect(Object.keys(schema.tables).sort()).toEqual(Object.keys(EXPECTED_INDEXES).sort())
  })

  for (const [table, indexes] of Object.entries(EXPECTED_INDEXES)) {
    describe(table, () => {
      const exported = tables[table].export()

      for (const [name, fields] of Object.entries(indexes)) {
        it(`has index ${name} on [${fields.join(', ')}]`, () => {
          const match = exported.indexes.find((i) => i.indexDescriptor === name)
          expect(match, `index ${name} missing`).toBeDefined()
          // Convex appends the implicit _creationTime tiebreaker; compare the prefix.
          expect(match?.fields.slice(0, fields.length)).toEqual(fields)
        })
      }

      it('uses no v.any() fields', () => {
        const json = JSON.stringify(exported.documentType)
        expect(json).not.toContain('"type":"any"')
      })
    })
  }
})
