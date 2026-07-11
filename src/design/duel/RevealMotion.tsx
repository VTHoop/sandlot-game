import { MotionConfig, motion, useReducedMotion } from 'motion/react'
import { useEffect, useMemo, useState } from 'react'
import { Button } from '../../components/ui/Button'
import type { OutcomeKey } from '../../components/ui/OutcomeLadder'
import { Scoreboard } from '../../components/ui/Scoreboard'
import { ScoreTile } from '../../components/ui/ScoreTile'
import { FieldDiagram } from './FieldDiagram'
import { deriveDrama, formatInning, isHit, OUTCOME_NAMES, type RevealScenario } from './scenario'

const FLAP_SPRING = { type: 'spring', stiffness: 320, damping: 17 } as const

const HIT_TARGETS = new Map<OutcomeKey, { x: number; y: number }>([
  ['HR', { x: 120, y: 16 }],
  ['3B', { x: 178, y: 52 }],
  ['2B', { x: 76, y: 56 }],
  ['1B', { x: 98, y: 96 }],
  ['IF1B', { x: 106, y: 142 }],
])

// Deterministic hash jitter: same at-bat always maps to the same spray-chart mark.
function hitLocation(outcome: OutcomeKey, seed: number): { x: number; y: number } | null {
  const target = HIT_TARGETS.get(outcome)
  if (!target) return null
  const h = (seed * 2654435761) >>> 0
  return {
    x: target.x + (h % 25) - 12,
    y: target.y + ((h >>> 8) % 17) - 8,
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
  outcome: OutcomeKey
  callout: string | null
  outcomeAt: number
  calloutAt: number
}

function OutcomeCallout({ outcome, callout, outcomeAt, calloutAt }: OutcomeCalloutProps) {
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
        {OUTCOME_NAMES[outcome]}
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

interface FieldPlayProps {
  outcome: OutcomeKey
  hit: { x: number; y: number } | null
  fieldAt: number
  tracerAt: number
  runnersAt: number
}

function FieldPlay({ outcome: _outcome, hit, fieldAt, tracerAt, runnersAt }: FieldPlayProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: fieldAt, duration: 0.5 }}
      className="relative"
    >
      <FieldDiagram runners="none" />
      {hit && (
        <svg aria-hidden="true" className="absolute inset-0" viewBox="0 0 240 240">
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
        </svg>
      )}
      <motion.span
        aria-hidden="true"
        className="absolute top-0 left-0 size-4 rounded-full bg-clay-bright shadow-(--shadow-runner-clay)"
        initial={{ x: 112, y: 32, opacity: 0 }}
        animate={{ x: [112, 27, 112], y: [32, 117, 202], opacity: [1, 1, 0] }}
        transition={{ delay: runnersAt, duration: 1.3, times: [0, 0.5, 1], ease: 'easeInOut' }}
      />
      <motion.span
        aria-hidden="true"
        className="absolute top-0 left-0 size-4 rounded-full bg-consequence shadow-(--shadow-runner)"
        initial={{ x: 112, y: 202, opacity: 0 }}
        animate={{ x: [112, 197, 112], y: [202, 117, 32], opacity: [1, 1, 1] }}
        transition={{
          delay: runnersAt + 0.1,
          duration: 1.6,
          times: [0, 0.5, 1],
          ease: 'easeInOut',
        }}
      />
    </motion.div>
  )
}

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
  const runTickAt = runnersAt + 1.15
  const scorelineAt = runnersAt + 1.7

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
          outcome={scenario.outcome}
          callout={drama.callout}
          outcomeAt={outcomeAt}
          calloutAt={calloutAt}
        />
        <FieldPlay
          outcome={scenario.outcome}
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
