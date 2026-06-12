import type { ReactNode } from 'react'

interface DuelChromeProps {
  /** Optional one-line situation; commit screens omit it — the screen itself is the situation (ADR-0014). */
  situation?: ReactNode
  opponent: string
  opponentOnline: boolean
  children: ReactNode
}

/** Shared duel-screen frame: league wordmark, opponent presence, screen body. */
export function DuelChrome({ situation, opponent, opponentOnline, children }: DuelChromeProps) {
  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between px-5 pt-4 pb-2 font-body text-xs tracking-wider text-muted">
        <span>SANDLOT ___</span>
        <span className="flex items-center gap-1.5">
          vs. <span className="text-chalk">{opponent}</span>
          <span
            role="img"
            aria-label={`${opponent} is ${opponentOnline ? 'online' : 'offline'}`}
            className={`size-2 rounded-full ${opponentOnline ? 'bg-online' : 'bg-offline'}`}
          />
        </span>
      </header>
      {situation ? <p className="px-5 pb-2 font-body text-sm text-chalk">{situation}</p> : null}
      {children}
    </div>
  )
}
