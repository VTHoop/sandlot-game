import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { SHOWCASE_SITUATION } from './fixture'
import { WaitingTurn } from './WaitingTurn'

afterEach(cleanup)

describe('WaitingTurn', () => {
  it('shows the live base state on the field while waiting (SAN-51)', () => {
    render(<WaitingTurn situation={SHOWCASE_SITUATION} />)
    // The showcase situation has a runner on 2nd → that runner plus the batter,
    // and the field describes its occupancy to assistive tech.
    expect(screen.getAllByTestId('runner-token')).toHaveLength(2)
    screen.getByRole('img', { name: 'Runner on 2nd' })
  })
})
