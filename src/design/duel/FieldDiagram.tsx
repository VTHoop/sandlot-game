import type { FieldSpot } from './scenario'

interface FieldDiagramProps {
  /**
   * `static`: lone runner holding 2nd · `none`: bare diamond (caller overlays
   * its own runner tokens / spray-chart marks).
   */
  runners?: 'static' | 'none'
  /** Occupied spots rendered as live-state runner tokens (SAN-51). */
  runnersOn?: readonly FieldSpot[]
  /** Size classes; the diagram scales with its box (overlays use the 240 viewBox). */
  className?: string
}

const BASES = [
  { x: 199, y: 119, cx: 205, cy: 125 },
  { x: 114, y: 34, cx: 120, cy: 40 },
  { x: 29, y: 119, cx: 35, cy: 125 },
  { x: 114, y: 204, cx: 120, cy: 210 },
]

/**
 * The field is a chalk-line diagram, never an illustration (ADR-0012).
 * Runner tokens read as light against the dusk canvas.
 */
export function FieldDiagram({ runners = 'static', className = 'h-60 w-60' }: FieldDiagramProps) {
  return (
    <div aria-hidden="true" className={`relative ${className}`}>
      <svg className="absolute inset-0 h-full w-full" viewBox="0 0 240 240">
        <title>Field diagram</title>
        <path d="M120 210 L205 125 L120 40 L35 125 Z" fill="rgb(245 241 230 / 0.04)" />
        <path
          d="M120 210 L205 125 L120 40 L35 125 Z"
          className="stroke-chalk"
          fill="none"
          strokeWidth="2.5"
          strokeDasharray="8 6"
          strokeLinejoin="round"
        />
        {BASES.map((base) => (
          <rect
            key={`${base.cx}-${base.cy}`}
            className="fill-chalk"
            x={base.x}
            y={base.y}
            width="12"
            height="12"
            transform={`rotate(45 ${base.cx} ${base.cy})`}
          />
        ))}
      </svg>
      {runners === 'static' && (
        <span
          className="absolute size-4 -translate-x-1/2 -translate-y-1/2 rounded-full bg-consequence shadow-(--shadow-runner)"
          style={{ left: '50%', top: '13.3%' }}
        />
      )}
    </div>
  )
}
