import type { GameContext } from '@sandlot/engine/game'
import { useState } from 'react'
import { Button } from '../../components/ui/Button'
import { DuelCommit } from './DuelCommit'
import { HalfSummaryCard } from './HalfSummaryCard'
import { RevealMotion } from './RevealMotion'
import { GAME_CONTEXT, ROSTER, type Roster } from './roster'
import { SeatControls } from './SeatControls'
import { DuelSeat, SeatKind, type SeatKinds } from './seatAgent'
import { type PlayView, PlayViewKind, useDuelPlay } from './useDuelPlay'

const seatLabel = (seat: DuelSeat): 'pitcher' | 'batter' =>
  seat === DuelSeat.Pitcher ? 'pitcher' : 'batter'

function CommitView({
  view,
  onLock,
}: {
  view: Extract<PlayView, { kind: PlayViewKind.Commit }>
  onLock: (n: number) => void
}) {
  return (
    // Key by seat so each seat opens on a fresh, empty number entry; the remount
    // hands keyboard focus to that entry (focusOnMount) instead of the body.
    <DuelCommit
      key={view.seat}
      seat={seatLabel(view.seat)}
      matchup={view.matchup}
      situation={view.situation}
      opponentLocked={view.opponentLocked}
      opponentOnline={false}
      onLock={onLock}
      focusOnMount
    />
  )
}

function ErrorView({ message, onRestart }: { message: string; onRestart: () => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-6 px-6 text-center">
      <p role="alert" className="font-body text-sm text-consequence">
        {message}
      </p>
      <Button variant="consequence" className="px-6 py-3 text-sm" onClick={onRestart}>
        PLAY AGAIN
      </Button>
    </div>
  )
}

interface HalfInningProps {
  roster: Roster
  context: GameContext
  seats: SeatKinds
  onRestart: () => void
}

/** One live half-inning: the loop's current view rendered by the shared screens. */
function DuelHalfInning({ roster, context, seats, onRestart }: HalfInningProps) {
  const { view, submitNumber, advanceReveal } = useDuelPlay(roster, context, seats)
  const [replayKey, setReplayKey] = useState(0)

  if (!view) return null
  if (view.kind === PlayViewKind.Commit) return <CommitView view={view} onLock={submitNumber} />
  if (view.kind === PlayViewKind.Reveal) {
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
  if (view.kind === PlayViewKind.Error)
    return <ErrorView message={view.message} onRestart={onRestart} />
  return <HalfSummaryCard summary={view.summary} onRestart={onRestart} />
}

interface DuelPlayProps {
  roster?: Roster
  context?: GameContext
}

const BOTH_HUMAN = {
  [DuelSeat.Pitcher]: SeatKind.Human,
  [DuelSeat.Batter]: SeatKind.Human,
} satisfies SeatKinds

/**
 * The playable half-inning (SAN-47, SAN-48): each seat is set to human or bot
 * independently, at-bats sequence through the live adapter, and the half ends at
 * the third out. Both seats default to human (the hotseat). Changing a seat or
 * restarting bumps an epoch that remounts a fresh half-inning — the loop's one-shot
 * effect re-seeds cleanly with the current seat fills.
 */
export function DuelPlay({ roster = ROSTER, context = GAME_CONTEXT }: DuelPlayProps = {}) {
  const [seats, setSeats] = useState<SeatKinds>(BOTH_HUMAN)
  const [epoch, setEpoch] = useState(0)
  const setSeat = (seat: DuelSeat, kind: SeatKind) => {
    setSeats((prev) => ({ ...prev, [seat]: kind }))
    setEpoch((e) => e + 1)
  }
  return (
    <div className="flex h-full flex-col">
      <SeatControls seats={seats} onChange={setSeat} />
      <div className="min-h-0 flex-1">
        <DuelHalfInning
          key={epoch}
          roster={roster}
          context={context}
          seats={seats}
          onRestart={() => {
            setEpoch((e) => e + 1)
          }}
        />
      </div>
    </div>
  )
}
