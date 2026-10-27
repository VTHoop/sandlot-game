import { IngestError, IngestSource } from './mlbFields'

/**
 * The Baseball Savant sprint-speed leaderboard (SAN-25, ADR-0037): a public CSV
 * download, not a documented API. Reduced here to what the Speed attribute needs.
 */

export interface SprintRecord {
  sprintSpeed: number
  competitiveRuns: number
}

/** One line's cells by column number. Quoted cells may hold commas; a doubled quote is a quote. */
function cellsOf(line: string): ReadonlyMap<number, string> {
  const cells = new Map<number, string>()
  const cell = /"((?:[^"]|"")*)"|([^,]*)/y
  let at = 0
  while (at <= line.length) {
    cell.lastIndex = at
    const match = cell.exec(line)
    if (!match) break
    // Typed as optional on purpose: exactly one of the two alternatives captured.
    const [, quoted, bare]: (string | undefined)[] = match
    cells.set(cells.size, quoted?.replace(/""/g, '"') ?? bare ?? '')
    at = cell.lastIndex + 1
  }
  return cells
}

function columnOf(header: ReadonlyMap<number, string>, name: string): number {
  const column = [...header].find(([, cell]) => cell === name)
  if (!column) throw new IngestError(IngestSource.SprintSpeed, `the file has no ${name} column`)
  return column[0]
}

function numberAt(
  cells: ReadonlyMap<number, string>,
  column: number,
  name: string,
  line: number,
): number {
  const cell = cells.get(column)
  const value = cell === undefined || cell === '' ? Number.NaN : Number(cell)
  if (!Number.isFinite(value)) {
    throw new IngestError(IngestSource.SprintSpeed, `line ${line} lacks ${name}`)
  }
  return value
}

/** The leaderboard keyed by MLB id (`player_id`); a player listed twice is a bad file. */
export function parseSprintSpeeds(csv: string): ReadonlyMap<number, SprintRecord> {
  const lines = csv
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .filter((line) => line.trim() !== '')
  const headerLine = lines.shift()
  if (headerLine === undefined || lines.length === 0) {
    throw new IngestError(IngestSource.SprintSpeed, 'returned no players')
  }
  const header = cellsOf(headerLine)
  const idColumn = columnOf(header, 'player_id')
  const runsColumn = columnOf(header, 'competitive_runs')
  const speedColumn = columnOf(header, 'sprint_speed')

  const records = new Map<number, SprintRecord>()
  for (const [i, line] of lines.entries()) {
    const cells = cellsOf(line)
    const at = i + 2
    const id = numberAt(cells, idColumn, 'player_id', at)
    if (records.has(id)) {
      throw new IngestError(IngestSource.SprintSpeed, `player ${id} is listed twice (line ${at})`)
    }
    records.set(id, {
      sprintSpeed: numberAt(cells, speedColumn, 'sprint_speed', at),
      competitiveRuns: numberAt(cells, runsColumn, 'competitive_runs', at),
    })
  }
  return records
}
