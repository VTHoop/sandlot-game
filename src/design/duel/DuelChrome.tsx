import type { ReactNode } from 'react'
import { type ClubPair, matchupTitle } from './scenario'

interface DuelChromeProps {
  /** Optional one-line situation; commit screens omit it — the screen itself is the situation (ADR-0014). */
  situation?: ReactNode
  /** Both clubs' scoreboard labels; the header names the matchup, away at home. */
  clubs: ClubPair<string>
  children: ReactNode
}

/**
 * Shared duel-screen frame: league wordmark, the matchup, screen body. The header
 * names both clubs rather than "the opponent" — it reads the same from either
 * seat, and to an owner of both clubs (SAN-39).
 */
export function DuelChrome({ situation, clubs, children }: DuelChromeProps) {
  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between px-5 pt-4 pb-2 font-body text-xs tracking-wider text-muted">
        <span>SANDLOT ___</span>
        <span className="text-chalk">{matchupTitle(clubs)}</span>
      </header>
      {situation ? <p className="px-5 pb-2 font-body text-sm text-chalk">{situation}</p> : null}
      {children}
    </div>
  )
}
