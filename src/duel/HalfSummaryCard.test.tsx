import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { HalfSummary } from './duelLoop'
import { HalfSummaryCard } from './HalfSummaryCard'

afterEach(cleanup)

/** The top of the 3rd is over: HAR put up 2 on 3 hits and leads 4–1. */
const SUMMARY: HalfSummary = {
  half: 'TOP',
  inning: 3,
  runs: 2,
  hits: 3,
  clubs: { away: 'HAR', home: 'RID' },
  score: { away: 4, home: 1 },
}

const scoreRegion = () => screen.getByRole('region', { name: 'Score' })
const halfRegion = () => screen.getByRole('region', { name: 'This half' })

describe('HalfSummaryCard — the game score takes the forefront (SAN-70)', () => {
  it('shows both clubs’ total runs, away then home, by club label', () => {
    render(<HalfSummaryCard summary={SUMMARY} />)
    expect(scoreRegion().textContent).toBe('HAR4RID1')
  })

  it('keeps the half’s runs and hits, beneath the score', () => {
    render(<HalfSummaryCard summary={SUMMARY} />)
    const half = halfRegion()
    expect(within(half).getByText('RUNS').nextElementSibling?.textContent).toBe('2')
    expect(within(half).getByText('HITS').nextElementSibling?.textContent).toBe('3')
    expect(
      scoreRegion().compareDocumentPosition(half) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  })

  it('sets the half’s totals smaller than the score, and never in amber', () => {
    render(<HalfSummaryCard summary={SUMMARY} />)
    const scoreRuns = within(scoreRegion()).getByText('4')
    const halfRuns = within(halfRegion()).getByText('2')
    expect(scoreRuns.className).toMatch(/\btext-5xl\b/)
    expect(halfRuns.className).not.toMatch(/\btext-(5xl|6xl)\b/)
    for (const figure of within(halfRegion()).getAllByText(/\S/)) {
      expect(figure.className).not.toMatch(/consequence/)
    }
  })
})
