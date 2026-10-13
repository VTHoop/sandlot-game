import { describe, expect, it } from 'vitest'
import { parseArgs, parseResult, reseatNote, seatingLine, USAGE } from './devGameArgs'

describe('dev:game — the command line', () => {
  it('takes --home, --away and --force', () => {
    expect(parseArgs(['--home', 'sam', '--away', 'max', '--force'])).toEqual({
      home: 'sam',
      away: 'max',
      force: true,
    })
  })

  it('takes no arguments at all', () => {
    expect(parseArgs([])).toEqual({})
  })

  it('ignores the separator pnpm forwards', () => {
    expect(parseArgs(['--', '--home', 'sam'])).toEqual({ home: 'sam' })
  })

  it('keeps a multi-word name whole when it arrives as one argument', () => {
    expect(parseArgs(['--home', 'Sam Hooper'])).toEqual({ home: 'Sam Hooper' })
  })

  it.each(['--hotseat', '--as', '--bogus', 'sam'])('fails on %s with the usage line', (flag) => {
    expect(() => parseArgs([flag])).toThrow(USAGE)
  })

  it.each([
    ['--home'],
    ['--away'],
    ['--home', '--force'],
  ])('fails when %s has no name, with the usage line', (...argv) => {
    expect(() => parseArgs(argv.flat())).toThrow(USAGE)
  })

  it('describes --home, --away and --force in the usage line', () => {
    expect(USAGE).toMatch(/--home.*--away.*--force/)
  })
})

describe('dev:game — the printed link', () => {
  it('names two accounts by full display name', () => {
    expect(seatingLine({ home: 'Sam Hooper', away: 'Max Rivera' })).toBe(
      'Sam Hooper (home) vs. Max Rivera (away)',
    )
  })

  it('names the bot when it plays', () => {
    expect(seatingLine({ home: 'Sam Hooper', away: 'bot' })).toBe(
      'Sam Hooper (home) vs. bot (away)',
    )
  })

  it('names one account twice when it holds both clubs', () => {
    expect(seatingLine({ home: 'Sam Hooper', away: 'Sam Hooper' })).toBe(
      'Sam Hooper (home) vs. Sam Hooper (away)',
    )
  })
})

describe('dev:game — the re-seat note', () => {
  const result = { game: 'jd71', home: 'Sam Hooper', away: 'Max Rivera' }

  it('prints nothing when no game was re-seated', () => {
    expect(reseatNote({ ...result, reseated: 0 })).toBeNull()
  })

  it('says how many games, and who now holds the clubs', () => {
    expect(reseatNote({ ...result, reseated: 1 })).toBe(
      'Re-seated 1 earlier game: Sam Hooper (home) vs. Max Rivera (away).',
    )
    expect(reseatNote({ ...result, reseated: 3 })).toContain('3 earlier games')
  })
})

describe('dev:game — reading the result', () => {
  it('reads what the mutation returned', () => {
    const stdout = JSON.stringify({ game: 'jd71', home: 'Sam', away: 'bot', reseated: 0 }, null, 2)
    expect(parseResult(stdout)).toEqual({ game: 'jd71', home: 'Sam', away: 'bot', reseated: 0 })
  })

  it('refuses output that is not JSON, showing it', () => {
    expect(() => parseResult('Error: boom')).toThrow(
      /unexpected output from convex run:\nError: boom/,
    )
  })

  it('refuses output that is not a result', () => {
    expect(() => parseResult('"jd71"')).toThrow(/unexpected output/)
    expect(() => parseResult('{"game":"JD 71","home":"a","away":"b","reseated":0}')).toThrow(
      /unexpected output/,
    )
  })
})
