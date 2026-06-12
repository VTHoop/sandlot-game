type ScoreTileSize = 'md' | 'lg'

interface ScoreTileProps {
  value: string
  label?: string
  size?: ScoreTileSize
  className?: string
}

/**
 * A scoreboard tile: chalk numerals on a dark tile. The pick is composed on the
 * same tile the reveal flips, so entry visually foreshadows the reveal.
 */
export function ScoreTile({ value, label, size = 'lg', className = '' }: ScoreTileProps) {
  return (
    <div className="flex flex-col items-center gap-1.5">
      {label ? (
        <span className="font-body text-[11px] tracking-[0.22em] text-muted uppercase">
          {label}
        </span>
      ) : null}
      <span
        className={`inline-block rounded-(--radius-tile) border border-edge bg-surface text-center font-display tracking-wider text-chalk ${size === 'lg' ? 'px-5 py-1.5 text-6xl' : 'px-3 py-1 text-4xl'} ${className}`}
      >
        {value}
      </span>
    </div>
  )
}
