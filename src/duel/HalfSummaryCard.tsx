import { useEffect, useRef } from 'react'
import { Button } from '../components/ui/Button'
import type { HalfSummary } from './duelLoop'
import type { SideChange } from './liveDuel'
import { formatInning } from './scenario'

/** Where a real game goes from the card: the side change, and the way into it. */
export interface NextHalf {
  change: SideChange
  /** The player is ready for the next half's first at-bat. */
  onContinue: () => void
}

interface HalfSummaryCardProps {
  summary: HalfSummary
  /** A real game's way on (SAN-67). The side change and the control that moves
   * past it come together, so a card cannot announce one without the other. */
  next?: NextHalf
  /** Offer to play the half again — the showcase's fixture loop, which has no
   * next half. */
  onRestart?: () => void
}

/** One club's side of the game score: its label over its runs. */
function ClubScore({ label, runs }: { label: string; runs: number }) {
  return (
    <div className="flex flex-col items-center gap-1">
      <span className="font-display text-sm tracking-wider text-consequence">{label}</span>
      <span className="font-display text-5xl text-consequence">{runs}</span>
    </div>
  )
}

/** The game score, away then home, by club label (ADR-0030) — the card's lead,
 * and its amber: scoring is consequence. */
function GameScore({ summary }: { summary: HalfSummary }) {
  const { clubs, score } = summary
  return (
    <section aria-label="Score" className="flex items-end gap-10">
      <ClubScore label={clubs.away} runs={score.away} />
      <ClubScore label={clubs.home} runs={score.home} />
    </section>
  )
}

function HalfStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <dt className="font-body text-[11px] tracking-[0.22em] text-muted uppercase">{label}</dt>
      <dd className="font-display text-xl text-chalk">{value}</dd>
    </div>
  )
}

/** What the batting side did this half: secondary to the score, never amber. */
function HalfTotals({ summary }: { summary: HalfSummary }) {
  return (
    <section aria-label="This half" className="flex flex-col items-center gap-1.5">
      <p className="font-body text-[11px] tracking-[0.22em] text-muted uppercase">This half</p>
      <dl className="flex gap-6">
        <HalfStat label="RUNS" value={summary.runs} />
        <HalfStat label="HITS" value={summary.hits} />
      </dl>
    </section>
  )
}

/**
 * The side change and CONTINUE. The card stays up until the player taps it — the
 * server has already opened the next half, so nothing here waits on it — and the
 * control takes focus on arrival, so a keyboard or screen-reader player lands on
 * the one thing there is to do.
 */
function NextHalfControl({ next }: { next: NextHalf }) {
  const continueRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    continueRef.current?.focus()
  }, [])

  return (
    <>
      <p className="font-body text-sm tracking-wider text-chalk">
        {formatInning(next.change)} · {next.change.batting} bats
      </p>
      <Button
        ref={continueRef}
        variant="consequence"
        className="px-6 py-3 text-sm"
        onClick={next.onContinue}
      >
        CONTINUE →
      </Button>
    </>
  )
}

/** The end-of-half beat: the third out is in. The game score leads; what the
 * batting side did this half sits beneath it (SAN-70). */
export function HalfSummaryCard({ summary, next, onRestart }: HalfSummaryCardProps) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-7 px-6 text-center">
      <h2 className="font-body text-[11px] tracking-[0.22em] text-muted uppercase">
        {formatInning(summary)} · in the books
      </h2>
      <GameScore summary={summary} />
      <HalfTotals summary={summary} />
      {next && <NextHalfControl next={next} />}
      {onRestart && (
        <Button variant="consequence" className="px-6 py-3 text-sm" onClick={onRestart}>
          PLAY AGAIN
        </Button>
      )}
    </div>
  )
}
