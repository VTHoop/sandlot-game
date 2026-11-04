import { describe, expect, it } from 'vitest'
import type { NormalizeReport } from '../convex/normalize'
import { parseArgs, parseReport, reportLines, USAGE } from './normalize-mlb-args'

const report: NormalizeReport = {
  season: 2026,
  created: 1400,
  updated: 20,
  skipped: [{ mlbId: 900001, name: 'Dee Fenwick', reason: 'position unknown' }],
  scores: {
    power: [10, 20, 30, 40, 50],
    contact: [1, 2, 3, 4, 5],
    speed: [0, 0, 7, 0, 0],
    eye: [1, 1, 1, 1, 1],
    velocity: [2, 2, 2, 2, 2],
    movement: [3, 3, 3, 3, 3],
    awareness: [0, 0, 9, 0, 0],
    command: [4, 4, 4, 4, 4],
  },
}

describe('normalize:mlb — the command line', () => {
  it('takes a season', () => {
    expect(parseArgs(['--season', '2025'])).toEqual({ season: 2025 })
  })

  it('ignores the separator pnpm forwards', () => {
    expect(parseArgs(['--', '--season', '2025'])).toEqual({ season: 2025 })
  })

  it.each([
    [[]],
    [['--year', '2025']],
    [['2025']],
    [['--season', '2025', '--force']],
  ])('fails on %j with the usage line', (argv) => {
    expect(() => parseArgs(argv)).toThrow(USAGE)
  })

  it.each([
    [['--season']],
    [['--season', 'last']],
    [['--season', '25']],
  ])('fails on %j with the usage line when the year is not four digits', (argv) => {
    expect(() => parseArgs(argv)).toThrow(USAGE)
  })
})

describe('normalize:mlb — the report', () => {
  it('reads convex run output back into the report', () => {
    expect(parseReport(JSON.stringify(report))).toEqual(report)
  })

  it('prints the season, the counts, the skipped players by name and each attribute at 1–5', () => {
    const lines = reportLines(report)
    expect(lines[0]).toBe('Normalized 2026: 1400 created, 20 updated, 1 skipped.')
    expect(lines).toContain('  skipped Dee Fenwick (900001): position unknown')
    expect(lines).toContain('  power         10    20    30    40    50')
    expect(lines).toContain('  awareness      0     0     9     0     0')
    expect(lines).toHaveLength(1 + 1 + 1 + 8)
  })

  it.each([
    '',
    'not json',
    '[]',
    '{"season":2026}',
    JSON.stringify({ ...report, created: '1400' }),
    JSON.stringify({ ...report, skipped: [{ mlbId: 1 }] }),
    JSON.stringify({ ...report, scores: { ...report.scores, power: [1, 2, 3] } }),
    JSON.stringify({ ...report, scores: { ...report.scores, power: [1, 2, 3, 4, 'x'] } }),
  ])('refuses the output %j', (stdout) => {
    expect(() => parseReport(stdout)).toThrow('unexpected output from convex run')
  })
})
