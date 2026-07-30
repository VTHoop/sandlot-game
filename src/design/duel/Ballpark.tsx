import type { ReactNode } from 'react'
import type { OutcomeKey } from '../../components/ui/OutcomeLadder'
import type { LandingZone } from './ballFlight'
import { spotPoint } from './fieldMovement'
import { FieldSpot } from './scenario'

/**
 * The reveal's stage: a whole ballpark, not just the diamond.
 *
 * Deliberately NOT the same field as {@link FieldDiagram}. The commit and waiting
 * screens want a compact readout of who is on base; the reveal wants somewhere for
 * a batted ball to actually go. Keeping them as two components makes that
 * divergence structural — it retires SAN-51's "visually interchangeable" rule by
 * construction rather than by a prop nobody remembers to set.
 *
 * Everything the reveal animates (chrome, ball, runners) lives in this one
 * coordinate space, so a future camera only has to move the viewBox and the
 * contents follow for free.
 */

/** The park's coordinate window. Wider and taller than the diamond's 240 square:
 * the outfield runs well above the bases and past both foul poles. */
export const PARK_VIEWBOX = '-100 -120 440 360'

/**
 * Fence, warning track and infield arc are the SAME cubic curve nested at three
 * depths (250 / 232 / 166 units down the foul lines), so the park reads as one
 * shape language rather than a circle sitting under two curves. The infield's
 * crest clears second base (170 units) by 19 — half a true-scale infield's
 * overhang, given up so the outfield still reads in a park whose fences are
 * compressed relative to a real one.
 */
export const PARK_PATHS = {
  fence: 'M -57 33 C 20 -110, 220 -110, 297 33',
  warningTrack: 'M -44 46 C 26 -90, 214 -90, 284 46',
  infieldDirt: 'M 3 93 C 54 -3, 186 -3, 237 93 L 120 210 Z',
  fairTerritory: 'M 120 210 L -57 33 C 20 -110, 220 -110, 297 33 Z',
  leftFoulLine: 'M 120 210 L -57 33',
  rightFoulLine: 'M 120 210 L 297 33',
  diamond: 'M120 210 L205 125 L120 40 L35 125 Z',
} as const

/** Every outcome that actually puts a ball on the field. A walk and a strikeout
 * are the only two that never do — the type makes their absence structural, so a
 * new outcome cannot be added without deciding where it lands. */
export type BattedOutcome = Exclude<OutcomeKey, 'BB' | 'K'>

/** Half a base's width — bases are drawn as 12-unit squares centred on their spot. */
const BASE_HALF = 6

/** The bags, positioned from the shared geometry rather than a second copy of it. */
const BASE_SPOTS = [FieldSpot.First, FieldSpot.Second, FieldSpot.Third, FieldSpot.Home] as const

/**
 * Where each batted ball finishes, in park coordinates. These used to live in the reveal,
 * crammed into the diamond's 240 square — a home run at y=16 and a triple at y=52,
 * barely a bat's length apart above second base, because there was nowhere else to
 * put them. They belong with the park geometry: a landing zone only means something
 * relative to the dirt it clears and the fence it does or doesn't.
 *
 * Read against {@link PARK_PATHS}: `HR` clears the fence, `3B` drops in the corner
 * beyond the dirt's reach, `2B` splits the right-center gap, `1B` falls just onto
 * shallow grass, and `IF1B` dies on the dirt itself.
 */
export const LANDING_ZONES: Record<BattedOutcome, LandingZone> = {
  HR: { x: 132, y: -96, bow: 24, lift: 5.6, flight: 1.05 },
  '3B': { x: 262, y: 52, bow: 20, lift: 4.8, flight: 0.9 },
  '2B': { x: 232, y: 12, bow: 22, lift: 4.6, flight: 0.85 },
  '1B': { x: 40, y: 28, bow: 16, lift: 3.4, flight: 0.7 },
  IF1B: { x: 150, y: 152, bow: 12, lift: 2.2, flight: 0.5 },
  FO: { x: 0, y: 0, bow: 0, lift: 0, flight: 0 },
  PO: { x: 0, y: 0, bow: 0, lift: 0, flight: 0 },
  GB: { x: 0, y: 0, bow: 0, lift: 0, flight: 0 },
}

/** Max deterministic spray either side of a target, so the same at-bat always
 * marks the same spot. Landing zones must hold their region across this whole box. */
export const HIT_SPRAY = { x: 12, y: 8 } as const

interface BallparkProps {
  /** Anything drawn in park coordinates — the ball, its tracer, runner tokens. */
  children?: ReactNode
  className?: string
}

/**
 * The park as chalk lines on night grass (ADR-0012: a diagram, never an
 * illustration). Decorative throughout — the reveal states its outcome in the
 * headline and scoreline, so assistive tech is never asked to read the field.
 */
export function Ballpark({ children, className = 'w-full max-w-80' }: BallparkProps) {
  return (
    <svg aria-hidden="true" className={`block h-auto w-full ${className}`} viewBox={PARK_VIEWBOX}>
      <title>Ballpark</title>
      <path d={PARK_PATHS.fairTerritory} fill="rgb(245 241 230 / 0.028)" />
      <path d={PARK_PATHS.infieldDirt} fill="rgb(194 80 42 / 0.10)" />
      <path d={PARK_PATHS.diamond} fill="rgb(245 241 230 / 0.04)" />
      <path className="stroke-chalk" d={PARK_PATHS.leftFoulLine} strokeWidth="1.6" opacity="0.5" />
      <path className="stroke-chalk" d={PARK_PATHS.rightFoulLine} strokeWidth="1.6" opacity="0.5" />
      <path
        className="stroke-chalk"
        d={PARK_PATHS.warningTrack}
        fill="none"
        strokeWidth="1.2"
        strokeDasharray="3 7"
        opacity="0.3"
      />
      <path
        className="stroke-chalk"
        d={PARK_PATHS.fence}
        fill="none"
        strokeWidth="2.6"
        strokeLinecap="round"
        opacity="0.62"
      />
      <path
        className="stroke-chalk"
        d={PARK_PATHS.diamond}
        fill="none"
        strokeWidth="2.5"
        strokeDasharray="8 6"
        strokeLinejoin="round"
      />
      {BASE_SPOTS.map((spot) => {
        const { x, y } = spotPoint(spot)
        return (
          <rect
            key={spot}
            className="fill-chalk"
            x={x - BASE_HALF}
            y={y - BASE_HALF}
            width={BASE_HALF * 2}
            height={BASE_HALF * 2}
            transform={`rotate(45 ${x} ${y})`}
          />
        )
      })}
      {children}
    </svg>
  )
}
