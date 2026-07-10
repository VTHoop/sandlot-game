import type { GameContext } from '@sandlot/engine/game'
import { useState } from 'react'
import { DuelCommit } from './DuelCommit'
import { HalfSummaryCard } from './HalfSummaryCard'
import { RevealMotion } from './RevealMotion'
import { GAME_CONTEXT, ROSTER, type Roster } from './roster'
import { DuelSeat } from './seatAgent'
import { type PlayView, useDuelPlay } from './useDuelPlay'

const seatLabel = (seat: DuelSeat): 'pitcher' | 'batter' =>
  seat === DuelSeat.Pitcher ? 'pitcher' : 'batter'

function CommitView({
  view,
  onLock,
}: {
  view: Extract<PlayView, { kind: 'commit' }>
  onLock: (n: number) => void
}) {
  return (
    // Key by seat so each seat opens on a fresh, empty number entry.
    <DuelCommit
      key={view.seat}
      seat={seatLabel(view.seat)}
      matchup={view.matchup}
      situation={view.situation}
      opponentLocked={view.opponentLocked}
      opponentOnline={false}
      onLock={onLock}
    />
  )
}

interface HalfInningProps {
  roster: Roster
  context: GameContext
  onRestart: () => void
}

/** One live half-inning: the loop's current view rendered by the shared screens. */
function DuelHalfInning({ roster, context, onRestart }: HalfInningProps) {
  const { view, submitNumber, advanceReveal } = useDuelPlay(roster, context)
  const [replayKey, setReplayKey] = useState(0)

  if (!view) return null
  if (view.kind === 'commit') return <CommitView view={view} onLock={submitNumber} />
  if (view.kind === 'reveal') {
    return (
      <RevealMotion
        key={replayKey}
        scenario={view.scenario}
        onReplay={() => {
          setReplayKey((k) => k + 1)
        }}
        onAdvance={advanceReveal}
        advanceLabel={view.isFinalOfHalf ? 'END OF HALF →' : 'NEXT BATTER →'}
      />
    )
  }
  return <HalfSummaryCard summary={view.summary} onRestart={onRestart} />
}

interface DuelPlayProps {
  roster?: Roster
  context?: GameContext
}

/**
 * The playable hotseat half-inning (SAN-47): one person enters both seats, at-bats
 * sequence through the live adapter, and the half ends at the third out. Restart
 * remounts a fresh half-inning by keying on an epoch — the loop's one-shot effect
 * re-seeds cleanly.
 */
export function DuelPlay({ roster = ROSTER, context = GAME_CONTEXT }: DuelPlayProps = {}) {
  const [epoch, setEpoch] = useState(0)
  return (
    <DuelHalfInning
      key={epoch}
      roster={roster}
      context={context}
      onRestart={() => {
        setEpoch((e) => e + 1)
      }}
    />
  )
}
