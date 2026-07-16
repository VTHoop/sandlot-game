import { FIELD_VIEWBOX, spotPoint } from './fieldMovement'
import { FieldSpot } from './scenario'

interface FieldDiagramProps {
  /**
   * Occupied spots rendered as live-state runner tokens (SAN-51): the batter at
   * the plate plus each occupied base. Omit entirely for a bare, decorative
   * diamond the caller overlays (the reveal drives its own animated tokens).
   */
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
 * One shared token skin for both fields: the batter reads as the hero color, an
 * on-base runner as clay — so the commit screen's held diamond and the reveal's
 * animated one stay visually interchangeable (SAN-51 consistency).
 */
export function runnerTokenClass(isBatter: boolean): string {
  return isBatter
    ? 'bg-consequence shadow-(--shadow-runner)'
    : 'bg-clay-bright shadow-(--shadow-runner-clay)'
}

/** A viewBox coordinate as a percentage of the box, so tokens track any size. */
const pct = (v: number): string => `${((v / FIELD_VIEWBOX) * 100).toFixed(1)}%`

/** The three bases in on-field reading order — the label's order, not the data's
 * lead order. The batter is deliberately absent: they are always at the plate. */
const BASE_NAMES: ReadonlyArray<[FieldSpot, string]> = [
  [FieldSpot.First, '1st'],
  [FieldSpot.Second, '2nd'],
  [FieldSpot.Third, '3rd'],
]

/** The base state as a screen-reader sentence, so assistive tech hears what the
 * tokens show: "Bases empty" / "Runner on 2nd" / … / "Bases loaded". */
export function describeBases(runnersOn: readonly FieldSpot[]): string {
  const on = BASE_NAMES.filter(([spot]) => runnersOn.includes(spot)).map(([, name]) => name)
  if (on.length === 0) return 'Bases empty'
  if (on.length === 3) return 'Bases loaded'
  return `Runner${on.length > 1 ? 's' : ''} on ${on.join(' and ')}`
}

/**
 * The field is a chalk-line diagram, never an illustration (ADR-0012). With
 * `runnersOn` it renders the LIVE game state — one token per occupied spot,
 * described to assistive tech; without it, it is a decorative bare diamond.
 * Tokens sit on the same geometry the reveal animates over (`spotPoint`).
 */
export function FieldDiagram({ runnersOn, className = 'h-60 w-60' }: FieldDiagramProps) {
  const a11y = runnersOn
    ? ({ role: 'img', 'aria-label': describeBases(runnersOn) } as const)
    : ({ 'aria-hidden': true } as const)
  return (
    <div {...a11y} className={`relative ${className}`}>
      <svg
        aria-hidden="true"
        className="absolute inset-0 h-full w-full"
        viewBox={`0 0 ${FIELD_VIEWBOX} ${FIELD_VIEWBOX}`}
      >
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
      {runnersOn?.map((spot) => (
        <span
          key={spot}
          data-testid="runner-token"
          className={`absolute size-4 -translate-x-1/2 -translate-y-1/2 rounded-full ${runnerTokenClass(spot === FieldSpot.Batter)}`}
          style={{ left: pct(spotPoint(spot).x), top: pct(spotPoint(spot).y) }}
        />
      ))}
    </div>
  )
}
