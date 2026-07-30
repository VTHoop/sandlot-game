import { MotionConfig, motion, useReducedMotion } from 'motion/react'
import { memo, useEffect, useMemo, useState } from 'react'
import { Button } from '../../components/ui/Button'
import type { OutcomeKey } from '../../components/ui/OutcomeLadder'
import { Scoreboard } from '../../components/ui/Scoreboard'
import { ScoreTile } from '../../components/ui/ScoreTile'
import { Ballpark, HIT_SPRAY, LANDING_ZONES } from './Ballpark'
import {
  latestScoringArrival,
  type MovementPath,
  movementPath,
  RUNNER_STAGGER,
  travelDuration,
} from './fieldMovement'
import {
  deriveDrama,
  FieldSpot,
  formatInning,
  isHit,
  type RevealScenario,
  type RunnerMovement,
} from './scenario'

const FLAP_SPRING = { type: 'spring', stiffness: 320, damping: 17 } as const

// Deterministic hash jitter: same at-bat always maps to the same spray-chart mark.
// The landing zones themselves are park geometry and live with the park.
const TARGET_OF = new Map<OutcomeKey, { x: number; y: number }>(
  Object.entries(LANDING_ZONES) as [OutcomeKey, { x: number; y: number }][],
)

function hitLocation(outcome: OutcomeKey, seed: number): { x: number; y: number } | null {
  const target = TARGET_OF.get(outcome)
  if (!target) return null
  const h = (seed * 2654435761) >>> 0
  return {
    x: target.x + (h % (HIT_SPRAY.x * 2 + 1)) - HIT_SPRAY.x,
    y: target.y + ((h >>> 8) % (HIT_SPRAY.y * 2 + 1)) - HIT_SPRAY.y,
  }
}

interface ScoreFlapsProps {
  scenario: RevealScenario
  secondFlapAt: number
}

function ScoreFlaps({ scenario, secondFlapAt }: ScoreFlapsProps) {
  return (
    <div className="flex gap-8">
      <motion.div
        initial={{ rotateX: -92, opacity: 0 }}
        animate={{ rotateX: 0, opacity: 1 }}
        transition={{ ...FLAP_SPRING, delay: 0.3 }}
        style={{ transformOrigin: 'top' }}
      >
        <ScoreTile label="you" value={String(scenario.you)} size="md" />
      </motion.div>
      <motion.div
        initial={{ rotateX: -92, opacity: 0 }}
        animate={{ rotateX: 0, opacity: 1 }}
        transition={{ ...FLAP_SPRING, delay: secondFlapAt }}
        style={{ transformOrigin: 'top' }}
      >
        <ScoreTile label={scenario.opponent} value={String(scenario.them)} size="md" />
      </motion.div>
    </div>
  )
}

interface OutcomeCalloutProps {
  /** The already-named result (e.g. "DOUBLE PLAY", "HOME RUN!"), from the adapter. */
  headline: string
  callout: string | null
  outcomeAt: number
  calloutAt: number
}

function OutcomeCallout({ headline, callout, outcomeAt, calloutAt }: OutcomeCalloutProps) {
  return (
    <div className="flex flex-col items-center gap-2.5">
      <motion.p
        role="status"
        className="duel-glow font-display text-4xl text-consequence"
        style={{ animationDelay: `${outcomeAt}s` }}
        initial={{ opacity: 0, scale: 2.2 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ delay: outcomeAt, type: 'spring', stiffness: 380, damping: 22 }}
      >
        {headline}
      </motion.p>
      {callout && (
        <motion.span
          className="rounded-xs bg-clay px-2.5 py-1 font-display text-xs tracking-wider text-chalk"
          initial={{ opacity: 0, scale: 1.7, rotate: -7 }}
          animate={{ opacity: 1, scale: 1, rotate: -2 }}
          transition={{ delay: calloutAt, type: 'spring', stiffness: 300, damping: 18 }}
        >
          {callout}
        </motion.span>
      )}
    </div>
  )
}

// Runner token radius in park units — 16 across, matching the `size-4` tokens the
// commit and waiting screens draw with `runnerTokenClass`.
const TOKEN_RADIUS = 8

// Fraction of the run a forced runner covers before it starts to fade: it holds full
// opacity to here, then fades to nothing by the time it reaches the bag, so the out
// reads as recorded AT the base — not the token vanishing mid-path.
const FADE_START = 0.75

/**
 * Opacity animation for a runner retired on a force play — one that travels to the
 * bag and is out on arrival. It fades in on its starting base (the same 0.4s the
 * other tokens use), holds full through the run, then fades to nothing over the last
 * quarter so it bottoms out at the bag. Returns the keyframes plus a transition
 * spanning appear → arrival, since the fade-in (at `appearAt`) and the run (at
 * `moveAt`) live on one opacity track.
 */
function retiredTravelFade(appearAt: number, moveAt: number, travel: number) {
  const window = moveAt + travel - appearAt
  return {
    keyframes: [0, 1, 1, 0],
    transition: {
      delay: appearAt,
      duration: window,
      times: [0, 0.4 / window, (moveAt + FADE_START * travel - appearAt) / window, 1],
    },
  }
}

interface RunnerTokenProps {
  path: MovementPath
  index: number
  /** When the field (and thus the starting runners) appears. */
  fieldAt: number
  /** When the runners begin to move. */
  runnersAt: number
  /** The batter's own token reads as the hero color; on-base runners are clay. */
  isBatter: boolean
}

/**
 * One runner rendered on the field: it appears at its starting base as the field
 * settles (current state), then, when the play resolves, travels its real path —
 * or holds (a runner who stayed put) or fades (a runner retired on the play). The
 * position is driven by the movement's waypoints, never a canned route.
 */
function RunnerToken({ path, index, fieldAt, runnersAt, isBatter }: RunnerTokenProps) {
  // The reveal draws its runners INSIDE the park's SVG rather than as positioned
  // HTML: one coordinate space for the whole stage, so the ball, the bases and the
  // runners can never drift apart. `runnerTokenClass` still dresses the HTML tokens
  // on the commit and waiting screens; these are its in-SVG counterpart.
  const fill = isBatter ? 'fill-consequence' : 'fill-clay-bright'
  const glow = isBatter ? 'var(--drop-runner)' : 'var(--drop-runner-clay)'
  const appearAt = fieldAt + 0.2 + index * 0.05
  const moveAt = runnersAt + index * RUNNER_STAGGER

  if (!path.travels) {
    // A held runner sits on the base; a runner retired in place (strikeout / air out)
    // fades out where it stands as the play resolves.
    return (
      <motion.circle
        data-testid="runner-token"
        className={fill}
        r={TOKEN_RADIUS}
        cx={path.start.x}
        cy={path.start.y}
        style={{ filter: `drop-shadow(${glow})` }}
        initial={{ opacity: 0 }}
        animate={{ opacity: path.retired ? [1, 1, 0] : 1 }}
        transition={
          path.retired
            ? { delay: appearAt, duration: moveAt - appearAt + 0.6, times: [0, FADE_START, 1] }
            : { delay: appearAt, duration: 0.4 }
        }
      />
    )
  }

  const xs = path.waypoints.map((p) => p.x)
  const ys = path.waypoints.map((p) => p.y)
  const times = xs.map((_, i) => i / (xs.length - 1))
  const travel = travelDuration(path)
  // A forced runner travels to the bag and is out on arrival — fade it to nothing over
  // the last quarter of the run; everyone else stays fully opaque as they advance.
  const fade = path.retired ? retiredTravelFade(appearAt, moveAt, travel) : null
  return (
    <motion.circle
      data-testid="runner-token"
      className={fill}
      r={TOKEN_RADIUS}
      style={{ filter: `drop-shadow(${glow})` }}
      initial={{ cx: path.start.x, cy: path.start.y, opacity: 0 }}
      animate={{ cx: xs, cy: ys, opacity: fade ? fade.keyframes : 1 }}
      transition={{
        opacity: fade ? fade.transition : { delay: appearAt, duration: 0.4 },
        cx: { delay: moveAt, duration: travel, times, ease: 'easeInOut' },
        cy: { delay: moveAt, duration: travel, times, ease: 'easeInOut' },
      }}
    />
  )
}

interface FieldPlayProps {
  movements: RunnerMovement[]
  hit: { x: number; y: number } | null
  fieldAt: number
  tracerAt: number
  runnersAt: number
}

// Memoized: its props (movements, hit, timings) are stable across a reveal, so it
// skips the re-renders the two hit/run scoreboard-count flips would otherwise cause
// — no re-diffing the field or rebuilding the runner keyframe arrays.
const FieldPlay = memo(function FieldPlay({
  movements,
  hit,
  fieldAt,
  tracerAt,
  runnersAt,
}: FieldPlayProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: fieldAt, duration: 0.5 }}
      className="flex w-full justify-center"
    >
      <Ballpark>
        {hit && (
          <>
            <motion.line
              x1="120"
              y1="200"
              x2={hit.x}
              y2={hit.y}
              className="stroke-chalk"
              strokeWidth="2"
              strokeDasharray="6 5"
              initial={{ opacity: 0 }}
              animate={{ opacity: 0.7 }}
              transition={{ delay: tracerAt, duration: 0.35 }}
            />
            <motion.g
              className="stroke-chalk"
              strokeWidth="2.5"
              initial={{ opacity: 0 }}
              animate={{ opacity: 0.9 }}
              transition={{ delay: tracerAt + 0.4, duration: 0.2 }}
            >
              <line x1={hit.x - 5} y1={hit.y - 5} x2={hit.x + 5} y2={hit.y + 5} />
              <line x1={hit.x - 5} y1={hit.y + 5} x2={hit.x + 5} y2={hit.y - 5} />
            </motion.g>
          </>
        )}
        {movements.map((movement, index) => (
          <RunnerToken
            // Stable across a single reveal: each starting spot appears at most once.
            key={movement.from}
            path={movementPath(movement)}
            index={index}
            fieldAt={fieldAt}
            runnersAt={runnersAt}
            isBatter={movement.from === FieldSpot.Batter}
          />
        ))}
      </Ballpark>
    </motion.div>
  )
})

interface RevealMotionProps {
  scenario: RevealScenario
  onReplay?: () => void
  /** Advance past the reveal to the next at-bat (or the end-of-half hand-off). */
  onAdvance?: () => void
  /** Label for the advance control; ignored when `onAdvance` is absent. */
  advanceLabel?: string
}

/** The reveal beat: springs, drama-scaled pacing, and the scoreboard as consequence echo. */
export function RevealMotion({
  scenario,
  onReplay,
  onAdvance,
  advanceLabel = 'NEXT →',
}: RevealMotionProps) {
  const reduceMotion = useReducedMotion() ?? false
  const drama = deriveDrama(scenario)

  const secondFlapAt = 0.95
  const outcomeAt = reduceMotion ? 0 : secondFlapAt + 0.45 + drama.hold
  const calloutAt = outcomeAt + 0.55
  const fieldAt = outcomeAt + 0.9
  const tracerAt = fieldAt + 0.35
  const runnersAt = tracerAt + 0.5
  // Tick the scoreboard once the last run has actually crossed the plate — floored
  // at the original beat so a routine play keeps its pacing, extended when a
  // multi-run play (e.g. a grand slam) leaves tokens still rounding the bases.
  const runTickAt = Math.max(
    runnersAt + 1.15,
    latestScoringArrival(scenario.movements, runnersAt) + 0.15,
  )
  const scorelineAt = runTickAt + 0.55

  const [hitCounted, setHitCounted] = useState(false)
  const [runsCounted, setRunsCounted] = useState(false)

  useEffect(() => {
    if (reduceMotion) {
      setHitCounted(true)
      setRunsCounted(true)
      return
    }
    const hitTimer = setTimeout(
      () => {
        setHitCounted(true)
      },
      (outcomeAt + 0.15) * 1000,
    )
    const runTimer = setTimeout(() => {
      setRunsCounted(true)
    }, runTickAt * 1000)
    return () => {
      clearTimeout(hitTimer)
      clearTimeout(runTimer)
    }
  }, [reduceMotion, outcomeAt, runTickAt])

  const hit = useMemo(
    () => hitLocation(scenario.outcome, scenario.you * 10000 + scenario.them),
    [scenario.outcome, scenario.you, scenario.them],
  )

  return (
    <MotionConfig reducedMotion="user">
      <div
        className="flex h-full flex-col items-center gap-4 px-5 pt-8 pb-5"
        style={{ perspective: 600 }}
      >
        <ScoreFlaps scenario={scenario} secondFlapAt={secondFlapAt} />
        <OutcomeCallout
          headline={scenario.headline}
          callout={drama.callout}
          outcomeAt={outcomeAt}
          calloutAt={calloutAt}
        />
        <FieldPlay
          movements={scenario.movements}
          hit={hit}
          fieldAt={fieldAt}
          tracerAt={tracerAt}
          runnersAt={runnersAt}
        />
        <motion.p
          className="font-body text-[13px] tracking-[0.12em] text-consequence uppercase"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: scorelineAt, duration: 0.5 }}
        >
          {scenario.scoreline}
        </motion.p>
        <div className="mt-auto flex w-full flex-col gap-2">
          {onAdvance && (
            <Button variant="consequence" className="px-4 py-2 text-sm" onClick={onAdvance}>
              {advanceLabel}
            </Button>
          )}
          <Button variant="ghost" className="px-4 py-1.5 text-xs" onClick={onReplay}>
            ↺ REPLAY
          </Button>
          <Scoreboard
            away={{
              label: scenario.opponent.slice(0, 3).toUpperCase(),
              runs: scenario.scoreBefore.opp,
              hits: scenario.hitsBefore.opp,
            }}
            home={{
              label: 'YOU',
              runs: scenario.scoreBefore.you + (runsCounted ? scenario.runsScored : 0),
              hits: scenario.hitsBefore.you + (hitCounted && isHit(scenario.outcome) ? 1 : 0),
            }}
            inning={formatInning(scenario)}
            outs={scenario.outs}
          />
        </div>
      </div>
    </MotionConfig>
  )
}
