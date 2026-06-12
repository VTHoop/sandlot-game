const MAX_RATING = 5

interface AttributePipsProps {
  label: string
  value: number
}

/** A 1–5 attribute rating as chalk pips on a labeled row. */
export function AttributePips({ label, value }: AttributePipsProps) {
  return (
    <span className="flex items-center justify-between gap-2">
      <span className="font-body text-[10px] tracking-wider text-muted">{label}</span>
      <span
        role="img"
        aria-label={`${value} of ${MAX_RATING}`}
        className="text-[9px] tracking-[0.2em]"
      >
        {Array.from({ length: MAX_RATING }, (_, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: fixed-length static pips
          <span key={i} className={i < value ? 'text-chalk' : 'text-edge'}>
            ●
          </span>
        ))}
      </span>
    </span>
  )
}
