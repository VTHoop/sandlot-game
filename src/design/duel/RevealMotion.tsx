import { MotionConfig, motion, useReducedMotion } from 'motion/react'
import { memo, useEffect, useMemo, useState } from 'react'
import { Button } from '../../components/ui/Button'
import type { OutcomeKey } from '../../components/ui/OutcomeLadder'
import { Scoreboard } from '../../components/ui/Scoreboard'
import { ScoreTile } from '../../components/ui/ScoreTile'
import { Ballpark, HIT_SPRAY, LANDING_ZONES } from './Ballpark'
import {
  BALL_RADIUS,
  ballPointAt,
  ballRadiusAt,
  ballTrailPath,
  type LandingZone,
  PLATE,
} from './ballFlight'
import { type MovementPath, movementPath, RUNNER_STAGGER, travelDuration } from './fieldMovement'
import { cameraFrameAt, frameToViewBox } from './revealCamera'
import { compressToOutcome, REVEAL_TEMPO, revealBeats } from './revealTiming'
import {
  deriveDrama,
  FieldSpot,
  formatInning,
  isHit,
  type RevealScenario,
  type RunnerMovement,
} from './scenario'

const FLAP_SPRING = { type: 'spring', stiffness: 320, damping: 17 } as const

/** Story seconds → played seconds. Every duration and delay in the reveal passes
 * through here, so slowing the beat cannot leave one part at its old speed. */
const slow = (storySeconds: number): number => storySeconds * REVEAL_TEMPO

// Deterministic hash jitter: the same at-bat always sprays to the same spot, so a
// replay never relocates the ball. Zones themselves are park geometry.
const ZONE_OF = new Map<OutcomeKey, LandingZone>(
  Object.entries(LANDING_ZONES) as [OutcomeKey, LandingZone][],
)

function sprayedZone(outcome: OutcomeKey, seed: number): LandingZone | undefined {
  const zone = ZONE_OF.get(outcome)
  if (!zone) return undefined
  const h = (seed * 2654435761) >>> 0
  return {
    ...zone,
    x: zone.x + (h % (HIT_SPRAY.x * 2 + 1)) - HIT_SPRAY.x,
    y: zone.y + ((h >>> 8) % (HIT_SPRAY.y * 2 + 1)) - HIT_SPRAY.y,
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
        transition={{ ...FLAP_SPRING, delay: slow(0.3) }}
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
      times: [0, slow(0.4) / window, (moveAt + FADE_START * travel - appearAt) / window, 1],
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
  const appearAt = fieldAt + slow(0.2 + index * 0.05)
  const moveAt = runnersAt + slow(index * RUNNER_STAGGER)

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
            ? {
                delay: appearAt,
                duration: moveAt - appearAt + slow(0.6),
                times: [0, FADE_START, 1],
              }
            : { delay: appearAt, duration: slow(0.4) }
        }
      />
    )
  }

  const xs = path.waypoints.map((p) => p.x)
  const ys = path.waypoints.map((p) => p.y)
  const times = xs.map((_, i) => i / (xs.length - 1))
  const travel = slow(travelDuration(path))
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
        opacity: fade ? fade.transition : { delay: appearAt, duration: slow(0.4) },
        cx: { delay: moveAt, duration: travel, times, ease: 'easeInOut' },
        cy: { delay: moveAt, duration: travel, times, ease: 'easeInOut' },
      }}
    />
  )
}

interface BattedBallProps {
  zone: LandingZone
  outcome: OutcomeKey
  /** When contact happens, in played seconds. */
  ballAt: number
  /** How long the flight takes, in played seconds. */
  flight: number
}

/**
 * The batted ball: a trail that draws itself along the flight, the ball swelling
 * and shrinking to carry height a plan view cannot show, and a mark where it
 * finishes. Scorer's convention on the mark — a hit is a dot, an out is an X, so
 * shape rather than colour tells them apart. A home run gets neither; it left.
 */
function BattedBall({ zone, outcome, ballAt, flight }: BattedBallProps) {
  const trail = ballTrailPath(zone)
  const landedAt = ballAt + flight
  const hit = isHit(outcome)
  const gone = outcome === 'HR'
  // Sampled rather than eased: the radius has to peak at the apex of the flight,
  // which no single easing curve on a two-keyframe animation expresses.
  const steps = Array.from({ length: 9 }, (_, i) => i / 8)
  return (
    <>
      <motion.path
        d={trail}
        className="stroke-chalk"
        fill="none"
        strokeWidth="2.4"
        strokeLinecap="round"
        initial={{ pathLength: 0, opacity: 0 }}
        animate={{ pathLength: 1, opacity: 0.85 }}
        transition={{ delay: ballAt, duration: flight, ease: 'linear' }}
      />
      <motion.circle
        className="fill-chalk"
        initial={{ cx: PLATE.x, cy: PLATE.y, r: BALL_RADIUS, opacity: 0 }}
        animate={{
          cx: steps.map((u) => ballPointAt(zone, u).x),
          cy: steps.map((u) => ballPointAt(zone, u).y),
          r: steps.map((u) => ballRadiusAt(zone, u)),
          opacity: [0, 1, 1, 0],
        }}
        transition={{
          cx: { delay: ballAt, duration: flight, ease: 'linear' },
          cy: { delay: ballAt, duration: flight, ease: 'linear' },
          r: { delay: ballAt, duration: flight, ease: 'linear' },
          opacity: { delay: ballAt, duration: flight, times: [0, 0.05, 0.95, 1] },
        }}
      />
      {!gone && (
        <motion.g
          data-testid={hit ? 'landing-hit' : 'landing-out'}
          transform={`translate(${zone.x} ${zone.y})`}
          initial={{ opacity: 0 }}
          animate={{ opacity: hit ? 0.95 : 0.9 }}
          transition={{ delay: landedAt, duration: slow(0.25) }}
        >
          {hit ? (
            <>
              <circle
                className="stroke-chalk"
                r="9.5"
                fill="none"
                strokeWidth="1.5"
                opacity="0.5"
              />
              <circle className="fill-chalk" r="4.2" />
            </>
          ) : (
            <g className="stroke-chalk" strokeWidth="2.6">
              <line x1="-6" y1="-6" x2="6" y2="6" />
              <line x1="-6" y1="6" x2="6" y2="-6" />
            </g>
          )}
        </motion.g>
      )}
    </>
  )
}

interface FieldPlayProps {
  movements: RunnerMovement[]
  zone: LandingZone | undefined
  outcome: OutcomeKey
  fieldAt: number
  ballAt: number
  runnersAt: number
}

// Memoized: its props (movements, hit, timings) are stable across a reveal, so it
// skips the re-renders the two hit/run scoreboard-count flips would otherwise cause
// — no re-diffing the field or rebuilding the runner keyframe arrays.
const FieldPlay = memo(function FieldPlay({
  movements,
  zone,
  outcome,
  fieldAt,
  ballAt,
  runnersAt,
}: FieldPlayProps) {
  // The camera opens across exactly the flight and then holds, so the frame it
  // rests in says how far the ball went. Sampled into keyframes because the
  // viewBox is an attribute, not a transform.
  // Sampled in STORY seconds from contact, then played back over the scaled flight:
  // the shape of the move is tempo-independent, only its duration is not.
  const flight = slow(zone?.flight ?? 0)
  const sweep = Array.from({ length: 13 }, (_, i) =>
    frameToViewBox(cameraFrameAt((i / 12) * (zone?.flight ?? 0), { zone, ballAt: 0 })),
  )
  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: fieldAt, duration: 0.5 }}
      className="flex w-full justify-center"
    >
      <Ballpark
        viewBox={sweep[0]}
        animate={zone ? { viewBox: sweep } : undefined}
        transition={{ delay: ballAt, duration: flight, ease: 'linear' }}
      >
        {zone && <BattedBall zone={zone} outcome={outcome} ballAt={ballAt} flight={flight} />}
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

  const secondFlapAt = slow(0.95)
  // Reduced motion drops the held breath in front of the outcome rather than only
  // the headline's own delay — otherwise the field, ball and runners still wait it
  // out and the viewer sits in front of an empty screen.
  const played = revealBeats(scenario)
  const beats = reduceMotion ? compressToOutcome(played) : played
  const { outcomeAt, calloutAt, fieldAt, ballAt, runnersAt, runTickAt, scorelineAt } = beats

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

  const zone = useMemo(
    () => sprayedZone(scenario.outcome, scenario.you * 10000 + scenario.them),
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
          zone={zone}
          outcome={scenario.outcome}
          fieldAt={fieldAt}
          ballAt={ballAt}
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
