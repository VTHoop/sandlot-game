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

/** The lit scoreboard: the consequence echo of every play. */
export function Scoreboard({ away, home, inning, outs }: ScoreboardProps) {
  return (
    <Card className="flex w-full items-center justify-between px-4 py-2.5">
      <TeamCell team={away} />
      <span className="flex flex-col items-center">
        <span className="font-body text-[11px] tracking-[0.18em] text-muted">{inning}</span>
        {outs !== undefined && (
          <span className="font-body text-[9px] tracking-[0.18em] text-muted">{outs} OUT</span>
        )}
      </span>
      <TeamCell team={home} />
    </Card>
  )
}
