import { useEffect, useRef } from 'react'
import { ClubSide } from '../../convex/clubSide'
import type { InningLine } from '../../convex/gameView'
import { Card } from '../components/ui/Card'
import type { FinalGameView } from '../duel/liveDuel'
import { clubLabel } from '../duel/scenario'
import { HomeLink, Screen } from './Screen'

/**
 * A finished game at `/game/:id` (SAN-67): who won, the final score, the line
 * score, and the way home. Rendered from `getGame`'s final variant alone, so a
 * reload after the final lands here with nothing to replay.
 *
 * There is no tie state: the engine seals a game only on a decided inning, with
 * no inning cap (ADR-0017).
 */

const CELL = 'px-2 py-1.5 text-center tabular-nums'

/** The club column stays put while a long extra-innings line scrolls under it. */
const CLUB_CELL = 'sticky left-0 bg-surface px-2 py-1.5 text-left'

/** One club's runs in an inning, or null for a bottom half never played. Explicit
 * reads, one per side — no computed member access (AGENTS.md). */
const runsIn = (line: InningLine, side: ClubSide): number | null =>
  side === ClubSide.Home ? line.home : line.away

/** One club's row: runs by inning ("X" for a half never played), then R and H.
 * The header shows the scoreboard label and is named in full. */
function LineRow({ game, side }: { game: FinalGameView; side: ClubSide }) {
  const home = side === ClubSide.Home
  const name = home ? game.home.name : game.away.name
  return (
    <tr className="border-t border-edge">
      <th scope="row" aria-label={name} className={`${CLUB_CELL} font-display tracking-wider`}>
        {clubLabel(name)}
      </th>
      {game.lineScore.map((line) => (
        <td key={line.inning} className={`${CELL} text-muted`}>
          {runsIn(line, side) ?? 'X'}
        </td>
      ))}
      <td className={`${CELL} font-display text-consequence`}>
        {home ? game.score.home : game.score.away}
      </td>
      <td className={`${CELL} font-display text-chalk`}>
        {home ? game.hits.home : game.hits.away}
      </td>
    </tr>
  )
}

/**
 * The line score, away over home. It scrolls inside its own named region, not
 * the page: extra innings have no cap, and the page is a phone-width column.
 * The region takes `tabIndex={0}` so a keyboard player can scroll it: Chromium
 * and Firefox make such a scroller focusable on their own, Safari does not.
 */
function LineScore({ game }: { game: FinalGameView }) {
  return (
    <Card className="w-full">
      {/* biome-ignore lint/a11y/noNoninteractiveTabindex: WCAG 2.1.1 — scrollable content must be keyboard-reachable, and nothing inside this region is focusable (AGENTS.md's WCAG exception) */}
      <section aria-label="Line score" tabIndex={0} className="overflow-x-auto">
        <table className="w-full font-body text-sm text-chalk">
          <caption className="sr-only">Line score</caption>
          <thead>
            <tr className="text-[11px] tracking-[0.18em] text-muted">
              <th scope="col" className={CLUB_CELL}>
                <span className="sr-only">Club</span>
              </th>
              {game.lineScore.map((line) => (
                <th key={line.inning} scope="col" className={CELL}>
                  {line.inning}
                </th>
              ))}
              <th scope="col" className={CELL}>
                R
              </th>
              <th scope="col" className={CELL}>
                H
              </th>
            </tr>
          </thead>
          <tbody>
            <LineRow game={game} side={ClubSide.Away} />
            <LineRow game={game} side={ClubSide.Home} />
          </tbody>
        </table>
      </section>
    </Card>
  )
}

/**
 * The winner and the final score, winner's runs first. A tied `final` is
 * unreachable in play; if one arrives this refuses rather than crowning either
 * club (AGENTS.md: refuse rather than guess).
 */
function resultOf(game: FinalGameView): { winner: string; score: string } {
  const { winner, score } = game
  if (winner === ClubSide.Home) {
    return { winner: game.home.name, score: `${score.home}–${score.away}` }
  }
  if (winner === ClubSide.Away) {
    return { winner: game.away.name, score: `${score.away}–${score.home}` }
  }
  throw new Error('A final game reported no winner, and the engine cannot end one tied')
}

export function GameOver({ game }: { game: FinalGameView }) {
  const headingRef = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    headingRef.current?.focus()
  }, [])
  const result = resultOf(game)

  return (
    <Screen>
      <h1
        ref={headingRef}
        tabIndex={-1}
        className="font-body text-[11px] tracking-[0.22em] text-muted uppercase outline-none"
      >
        FINAL
      </h1>
      <p className="font-display text-3xl tracking-wider text-chalk uppercase">
        {result.winner} win
      </p>
      <p className="font-display text-6xl text-consequence">{result.score}</p>
      <LineScore game={game} />
      <HomeLink />
    </Screen>
  )
}
