import { mkdirSync, writeFileSync } from 'node:fs'
import { aggregateGrid } from './grid'
import { DEFAULT_LINEAR_WEIGHTS } from './linearWeights'
import type { CellResult, GridArtifact, RunValues } from './types'

/** Path of the machine-readable SAN-18 artifact (gitignored generated output). */
export const ARTIFACT_PATH = 'packages/engine/artifacts/san14-grid.json'

/** Serialize the artifact to ARTIFACT_PATH. */
export function emitArtifact(artifact: GridArtifact): void {
  mkdirSync('packages/engine/artifacts', { recursive: true })
  writeFileSync('packages/engine/artifacts/san14-grid.json', JSON.stringify(artifact, null, 2))
}

/** Print a human-readable aggregate slash line summary to stdout. */
export function printAggregateSummary(
  cells: CellResult[],
  weights: RunValues = DEFAULT_LINEAR_WEIGHTS,
): void {
  const agg = aggregateGrid(cells)
  console.log('── SAN-14 Aggregate Slash Line (default differential distribution) ──')
  console.log(
    `  AVG  ${agg.avg.toFixed(3)}  OBP  ${agg.obp.toFixed(3)}  SLG  ${agg.slg.toFixed(3)}`,
  )
  console.log(
    `  HR%  ${(agg.hrPct * 100).toFixed(1)}%   K%  ${(agg.kPct * 100).toFixed(1)}%   BB%  ${(agg.bbPct * 100).toFixed(1)}%`,
  )
  console.log(
    `  Linear weights: HR=${weights.hr} 3B=${weights.triple} 2B=${weights.double} 1B=${weights.single} BB=${weights.bb} outs=${weights.fo}/${weights.po}/${weights.gb} K=${weights.k}`,
  )
}
