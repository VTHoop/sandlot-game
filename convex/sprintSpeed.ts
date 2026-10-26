import { IngestError } from './mlbFields'

/**
 * The Baseball Savant sprint-speed leaderboard (SAN-25, ADR-0037): a public CSV
 * download, not a documented API. Reduced here to what the Speed attribute needs.
 */

export interface SprintRecord {
  sprintSpeed: number
  competitiveRuns: number
}

/** One line's cells. Quoted cells may hold commas; a doubled quote is a quote. */
function cellsOf(line: string): string[] {
  const cells: string[] = []
  const cell = /"((?:[^"]|"")*)"|([^,]*)/y
  let at = 0
  while (at <= line.length) {
    cell.lastIndex = at
    const match = cell.exec(line)
    if (!match) break
    cells.push(match[1]?.replace(/""/g, '"') ?? match[2] ?? '')
    at = cell.lastIndex + 1
  }
  return cells
}

function columnOf(header: string[], name: string): number {
  const column = header.indexOf(name)
  if (column < 0) throw new IngestError('sprint-speed', `the file has no ${name} column`)
  return column
}

function numberAt(cells: string[], column: number, name: string, line: number): number {
  const cell = cells.slice(column)[0]
  const value = cell === undefined || cell === '' ? Number.NaN : Number(cell)
  if (!Number.isFinite(value)) throw new IngestError('sprint-speed', `line ${line} lacks ${name}`)
  return value
}

/** The leaderboard keyed by MLB id (`player_id`). */
export function parseSprintSpeeds(csv: string): ReadonlyMap<number, SprintRecord> {
  const lines = csv
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .filter((line) => line.trim() !== '')
  const [headerLine, ...records] = lines
  if (headerLine === undefined || records.length === 0) {
    throw new IngestError('sprint-speed', 'returned no players')
  }
  const header = cellsOf(headerLine)
  const idColumn = columnOf(header, 'player_id')
  const runsColumn = columnOf(header, 'competitive_runs')
  const speedColumn = columnOf(header, 'sprint_speed')

  return new Map(
    records.map((line, i) => {
      const cells = cellsOf(line)
      const at = i + 2
      return [
        numberAt(cells, idColumn, 'player_id', at),
        {
          sprintSpeed: numberAt(cells, speedColumn, 'sprint_speed', at),
          competitiveRuns: numberAt(cells, runsColumn, 'competitive_runs', at),
        },
      ]
    }),
  )
}
