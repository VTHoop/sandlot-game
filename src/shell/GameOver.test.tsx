import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ClubSide } from '../../convex/gameView'
import type { FinalGameView } from '../duel/liveDuel'
import { finalView } from '../duel/testing/liveViews'
import { GameOver } from './GameOver'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const renderOver = (game: FinalGameView) =>
  render(
    <MemoryRouter>
      <GameOver game={game} />
    </MemoryRouter>,
  )

describe('GameOver — the result', () => {
  it('names an away winner and puts its runs first', () => {
    renderOver(finalView({ winner: ClubSide.Away, score: { away: 4, home: 2 } }))

    screen.getByText('Harbor Kingfishers win')
    screen.getByText('4–2')
  })

  it('refuses a final game with no winner rather than crowning either club', () => {
    // React reports the render error to the console before rethrowing it.
    vi.spyOn(console, 'error').mockImplementation(() => {})

    expect(() => renderOver(finalView({ winner: null, score: { away: 3, home: 3 } }))).toThrow(
      /no winner/,
    )
  })
})
