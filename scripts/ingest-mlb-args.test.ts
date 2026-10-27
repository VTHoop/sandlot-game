import { describe, expect, it } from 'vitest'
import { parseArgs, parseReport, reportLine, USAGE } from './ingest-mlb-args'

describe('ingest:mlb — the command line', () => {
  it('takes a season', () => {
    expect(parseArgs(['--season', '2025'])).toEqual({ season: 2025 })
  })

  it('takes no arguments, leaving the season to the server', () => {
    expect(parseArgs([])).toEqual({})
  })

  it('ignores the separator pnpm forwards', () => {
    expect(parseArgs(['--', '--season', '2025'])).toEqual({ season: 2025 })
  })

  it.each([
    ['--year', '2025'],
    ['2025'],
    ['--season', '2025', '--force'],
  ])('fails on %s with the usage line', (...argv) => {
    expect(() => parseArgs(argv.flat())).toThrow(USAGE)
  })

  it.each([
    ['--season'],
    ['--season', 'last'],
    ['--season', '25'],
  ])('fails on %s with the usage line when the year is not four digits', (...argv) => {
    expect(() => parseArgs(argv)).toThrow(USAGE)
  })
})

describe('ingest:mlb — the report', () => {
  it('reads convex run output and prints the season and the counts', () => {
    const report = parseReport('{"season":2026,"hitters":751,"pitchers":868}')
    expect(reportLine(report)).toBe('Ingested 2026: 751 hitters, 868 pitchers.')
  })

  it.each([
    '',
    'not json',
    '[]',
    '{"season":2026}',
    '{"season":"2026","hitters":1,"pitchers":1}',
  ])('refuses the output %j', (stdout) => {
    expect(() => parseReport(stdout)).toThrow('unexpected output from convex run')
  })
})
