import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { buttonClassName } from '../components/ui/Button'

/**
 * The frame every shell screen sits in: one centred column, mobile-first. The
 * width cap and side padding keep a 375px phone free of horizontal scroll.
 */
export function Screen({ children }: { children: ReactNode }) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col items-center justify-center gap-6 px-4 py-10 text-center">
      {children}
    </main>
  )
}

/** A screen's heading, set as the scoreboard would say it. */
export function Title({ children }: { children: ReactNode }) {
  return <h1 className="font-display text-2xl uppercase tracking-wider text-chalk">{children}</h1>
}

/** The app name, as the heading of screens that have no other. */
export function Wordmark() {
  return <Title>Sandlot</Title>
}

/** A wait, announced politely to screen readers. */
export function Waiting({ children }: { children: ReactNode }) {
  return (
    <p role="status" className="text-sm text-muted">
      {children}
    </p>
  )
}

export function HomeLink() {
  return (
    <Link to="/" className={`${buttonClassName('surface')} px-5 py-3 text-sm`}>
      Back to home
    </Link>
  )
}

/** A full-screen wait with the wordmark above it. */
export function WaitingScreen({ children }: { children: ReactNode }) {
  return (
    <Screen>
      <Wordmark />
      <Waiting>{children}</Waiting>
    </Screen>
  )
}
