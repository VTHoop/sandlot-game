import { useEffect, useRef, useState } from 'react'
import { Card } from './Card'

export interface TeamLine {
  label: string
  runs: number
  hits: number
}

interface ScoreboardProps {
  away: TeamLine
  home: TeamLine
  inning: string
  outs?: number
}

/** A number that split-flap ticks (amber → chalk) when its value changes. */
function TickValue({ value, className }: { value: number; className: string }) {
  const [hasTicked, setHasTicked] = useState(false)
  const previous = useRef(value)

  useEffect(() => {
    if (previous.current !== value) {
      previous.current = value
      setHasTicked(true)
    }
  }, [value])

  return (
    <span key={value} className={`${hasTicked ? 'motif-tick' : ''} ${className}`}>
      {value}
    </span>
  )
}

function TeamCell({ team }: { team: TeamLine }) {
  return (
    <span className="flex items-baseline gap-1.5 text-chalk">
      <span className="font-display text-sm tracking-wider">{team.label}</span>
      <TickValue value={team.runs} className="font-display text-2xl" />
      <span className="font-body text-[10px] text-muted">
        <TickValue value={team.hits} className="" />H
      </span>
    </span>
  )
}

// The three out slots, by index — outs are 0–3, one pip per possible out.
const OUT_SLOTS = [0, 1, 2] as const

/**
 * Outs as pips, not text: three 45°-rotated squares (the field's base-diamond
 * motif), filled chalk per recorded out. Outs are decision-critical situation
 * state, and the old 9px text was the least visible element on the duel screens
 * (SAN-51). Chalk, never amber — the color law reserves amber for consequence.
 */
function OutPips({ outs }: { outs: number }) {
  return (
    <span
      role="img"
      aria-label={`${outs} ${outs === 1 ? 'out' : 'outs'}`}
      className="flex items-center gap-1.5 pt-1"
    >
      {OUT_SLOTS.map((slot) => (
        <span
          key={slot}
          data-testid="out-pip"
          className={`size-2 rotate-45 ${slot < outs ? 'bg-chalk' : 'border border-edge'}`}
        />
      ))}
    </span>
  )
}

/** The lit scoreboard: the consequence echo of every play. */
export function Scoreboard({ away, home, inning, outs }: ScoreboardProps) {
  return (
    <Card className="flex w-full items-center justify-between px-4 py-2.5">
      <TeamCell team={away} />
      <span className="flex flex-col items-center">
        <span className="font-body text-[11px] tracking-[0.18em] text-muted">{inning}</span>
        {outs !== undefined && <OutPips outs={outs} />}
      </span>
      <TeamCell team={home} />
    </Card>
  )
}
