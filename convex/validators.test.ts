import { OUTCOME_BAND_KEYS } from '@sandlot/engine/outcomes'
import { describe, expect, it } from 'vitest'
import { outcomeBand } from './validators'

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
