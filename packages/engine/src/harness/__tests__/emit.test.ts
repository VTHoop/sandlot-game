import { existsSync, readFileSync, rmSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ARTIFACT_PATH, emitArtifact, printAggregateSummary } from '../emit'
import { buildArtifact, enumerateGrid } from '../grid'

const { cells } = enumerateGrid()

describe('emitArtifact', () => {
  afterEach(() => {
    if (existsSync(ARTIFACT_PATH)) rmSync(ARTIFACT_PATH)
  })

  it('creates ARTIFACT_PATH with valid JSON', () => {
    emitArtifact(buildArtifact(cells))
    expect(existsSync(ARTIFACT_PATH)).toBe(true)
    const parsed = JSON.parse(readFileSync(ARTIFACT_PATH, 'utf8')) as Record<string, unknown>
    expect(parsed).toHaveProperty('cells')
    expect(parsed).toHaveProperty('linearWeights')
  })

  it('serialized cells array length matches enumerateGrid valid cell count', () => {
    emitArtifact(buildArtifact(cells))
    const parsed = JSON.parse(readFileSync(ARTIFACT_PATH, 'utf8')) as { cells: unknown[] }
    expect(parsed.cells).toHaveLength(cells.length)
  })
})

describe('printAggregateSummary', () => {
  it('logs three lines containing AVG, OBP, and SLG labels', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    printAggregateSummary(cells)
    const output = spy.mock.calls.map((c) => String(c[0])).join('\n')
    expect(output).toContain('AVG')
    expect(output).toContain('OBP')
    expect(output).toContain('SLG')
    spy.mockRestore()
  })
})
