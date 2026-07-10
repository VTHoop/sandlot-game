import { Button } from '../../components/ui/Button'
import type { HalfSummary } from './duelLoop'
import { formatInning } from './scenario'

interface HalfSummaryCardProps {
  summary: HalfSummary
  onRestart: () => void
}

function StatBlock({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex flex-col items-center gap-1">
      <span className="font-display text-5xl text-consequence">{value}</span>
      <span className="font-body text-[11px] tracking-[0.22em] text-muted uppercase">{label}</span>
    </div>
  )
}

/** The end-of-half beat: the third out is in, here's what the batting side did. */
export function HalfSummaryCard({ summary, onRestart }: HalfSummaryCardProps) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-7 px-6 text-center">
      <p className="font-body text-[11px] tracking-[0.22em] text-muted uppercase">
        {formatInning(summary)} · in the books
      </p>
      <h2 className="font-display text-3xl tracking-wider text-chalk">END OF HALF</h2>
      <div className="flex gap-10">
        <StatBlock label="RUNS" value={summary.runs} />
        <StatBlock label="HITS" value={summary.hits} />
      </div>
      <Button variant="consequence" className="px-6 py-3 text-sm" onClick={onRestart}>
        PLAY AGAIN
      </Button>
    </div>
  )
}
