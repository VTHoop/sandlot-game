import type { BaseState } from '@sandlot/engine/atBat'
import { OUTCOME_BAND_KEYS } from '@sandlot/engine/outcomes'
import { describe, expect, it } from 'vitest'
import { baseState, outcomeBand } from './validators'

/**
 * Runtime single-source-of-truth backstop: the persisted `outcomeBand` enum must
 * equal the engine's band keys, in order. This is the test-suite (CI) twin of
 * the compile-time `AssertEqual` guard in validators.ts — it catches drift even
 * where a typecheck might be skipped, and is the runtime consumer that anchors
 * OUTCOME_BAND_KEYS to the schema.
 */

describe('outcomeBand validator', () => {
  it('matches the engine band keys exactly, in stack order', () => {
    const literals = outcomeBand.members.map((member) => member.value)
    expect(literals).toEqual([...OUTCOME_BAND_KEYS])
  })
})

/**
 * Runtime mirror for the runner-aware base state (SAN-44): the persisted
 * `baseState` must carry exactly the engine `BaseState` bases, each a
 * player-id-or-null. The `Record<keyof BaseState, …>` ties the expected field set
 * to the engine type at compile time, so a base added/renamed/dropped engine-side
 * fails this test — the twin of the boundary cast in `game.ts` / `atBat.ts`.
 */
describe('baseState validator', () => {
  it('mirrors the engine BaseState bases, each a player-id-or-null union', () => {
    const engineBases: Record<keyof BaseState, null> = { first: null, second: null, third: null }
    expect(Object.keys(baseState.fields).sort()).toEqual(Object.keys(engineBases).sort())
    for (const field of Object.values(baseState.fields)) {
      expect(field.kind).toBe('union')
      expect(field.members.map((m) => m.kind).sort()).toEqual(['id', 'null'])
      // …and the id half references `players`, not some other table — the exact
      // assumption the `game.ts`/`atBat.ts` boundary cast leans on.
      const idMember = field.members.find((m) => m.kind === 'id')
      expect(idMember?.tableName).toBe('players')
    }
  })
})
