import { describe, expect, it } from 'vitest'
import { managersLine, parseArgs, parseResult, USAGE } from './dev-game-args'

describe('dev:game — the command line', () => {
  it('takes --home and --away', () => {
    expect(parseArgs(['--home', 'sam', '--away', 'max'])).toEqual({ home: 'sam', away: 'max' })
  })

  it('takes --home-bot and --away-bot, to make either side bot-managed', () => {
    expect(parseArgs(['--home-bot', '--away', 'max'])).toEqual({ homeBot: true, away: 'max' })
    expect(parseArgs(['--home', 'sam', '--away-bot'])).toEqual({ home: 'sam', awayBot: true })
  })

  it('no longer takes --force', () => {
    expect(() => parseArgs(['--force'])).toThrow(USAGE)
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
    ['--home', '--away'],
  ])('fails when %s has no name, with the usage line', (...argv) => {
    expect(() => parseArgs(argv.flat())).toThrow(USAGE)
  })

  it('describes --home, --away, --home-bot and --away-bot in the usage line', () => {
    for (const flag of ['--home', '--away', '--home-bot', '--away-bot']) {
      expect(USAGE).toContain(flag)
    }
    expect(USAGE).not.toContain('--force')
  })
})

describe('dev:game — the printed link', () => {
  it('names two accounts by full display name', () => {
    expect(managersLine({ home: 'Sam Hooper', away: 'Max Rivera' })).toBe(
      'Sam Hooper (home) vs. Max Rivera (away)',
    )
  })

  it('names the bot when it plays', () => {
    expect(managersLine({ home: 'Sam Hooper', away: 'bot' })).toBe(
      'Sam Hooper (home) vs. bot (away)',
    )
  })

  it('names one account twice when it manages both sides', () => {
    expect(managersLine({ home: 'Sam Hooper', away: 'Sam Hooper' })).toBe(
      'Sam Hooper (home) vs. Sam Hooper (away)',
    )
  })
})

describe('dev:game — reading the result', () => {
  it('reads what the mutation returned', () => {
    const stdout = JSON.stringify({ game: 'jd71', home: 'Sam', away: 'bot' }, null, 2)
    expect(parseResult(stdout)).toEqual({ game: 'jd71', home: 'Sam', away: 'bot' })
  })

  it('refuses output that is not JSON, showing it', () => {
    expect(() => parseResult('Error: boom')).toThrow(
      /unexpected output from convex run:\nError: boom/,
    )
  })

  it('refuses a result missing a field', () => {
    expect(() => parseResult('{"game":"jd71","home":"a"}')).toThrow(/unexpected output/)
  })

  it('refuses output that is not a result', () => {
    expect(() => parseResult('"jd71"')).toThrow(/unexpected output/)
    expect(() => parseResult('{"game":"JD 71","home":"a","away":"b"}')).toThrow(/unexpected output/)
  })
})
