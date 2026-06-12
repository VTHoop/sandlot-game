// Produces packages/engine/artifacts/san14-grid.json (gitignored).
// Run from workspace root: pnpm emit-grid
import { emitArtifact, printAggregateSummary } from '../src/harness/emit'
import { buildArtifact, enumerateGrid } from '../src/harness/grid'
import { DEFAULT_LINEAR_WEIGHTS } from '../src/harness/linearWeights'

const { cells, degenerate } = enumerateGrid(DEFAULT_LINEAR_WEIGHTS)
emitArtifact(buildArtifact(cells))
printAggregateSummary(cells)
console.log(`Degenerate cells excluded: ${degenerate.length} of 14641`)
