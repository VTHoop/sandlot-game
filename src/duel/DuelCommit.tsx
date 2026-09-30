import { useState } from 'react'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { OutcomeLadder } from '../components/ui/OutcomeLadder'
import { Scoreboard } from '../components/ui/Scoreboard'
import { ScoreTileInput } from '../components/ui/ScoreTileInput'
import { DuelChrome } from './DuelChrome'
import { isValidDuelNumber } from './duelNumber'
import { FieldDiagram } from './FieldDiagram'
import { type DuelMatchup, MatchupCard } from './MatchupCard'
import {
  committerOf,
  type DuelSituation,
  formatInning,
  liveFieldSpots,
  oppositeSeat,
  type SeatCommitter,
  scoreboardLines,
} from './scenario'
import type { DuelSeat } from './seatAgent'

interface DuelCommitProps {
  /** Which seat this screen commits for; the situation it shows is the same for both. */
  seat: DuelSeat
  /** The at-bat's one matchup — the same two players for either seat. */
  matchup: DuelMatchup
  /**
   * The non-secret situation (scoreboard + inning + outs). Typed as
   * `DuelSituation` precisely because it CANNOT carry either duel number —
   * see the secret-state note on `opponentLocked`.
   */
  situation: DuelSituation
  /**
   * SECRET-STATE LAW: this component may only ever know THAT the opponent has
   * committed — never the number. Do not add a prop carrying it; the status
   * chip is static text either way. Commits are order-independent (ADR-0014).
   */
  opponentLocked: boolean
  /** Surfaces this seat's committed number to the parent when it locks. */
  onLock?: (committed: number) => void
  onReveal?: () => void
  /** Focus the number entry on mount — set when a seat-transition remount should
   * hand the keyboard straight to this seat (see `ScoreTileInput.focusOnMount`). */
  focusOnMount?: boolean
}

/**
 * The persistent status chip: THAT the other seat has locked, never the number.
 * It names the player and what they owe — "M. SLOANE's pitch" — so it reads the
 * same whoever is holding the phone.
 */
function OtherSeatChip({ other, locked }: { other: SeatCommitter; locked: boolean }) {
  return (
    <Card className="flex items-center justify-between gap-3 px-4 py-2">
      <span className="font-body text-[11px] tracking-[0.14em] text-muted uppercase">
        {`${other.player}’s ${other.act}`}
      </span>
      <span className="shrink-0 font-display text-sm tracking-wider whitespace-nowrap text-chalk">
        {locked ? '🔒 LOCKED' : 'NOT YET ENTERED'}
      </span>
    </Card>
  )
}

interface CommitActionProps {
  locked: boolean
  bothLocked: boolean
  opponent: string
  canLock: boolean
  onLock: () => void
  onReveal?: () => void
}

/** The blind commit's call to action: lock the number, then wait / reveal. */
function CommitAction({
  locked,
  bothLocked,
  opponent,
  canLock,
  onLock,
  onReveal,
}: CommitActionProps) {
  if (!locked) {
    return (
      <Button variant="consequence" className="py-3.5 text-lg" disabled={!canLock} onClick={onLock}>
        LOCK IT IN
      </Button>
    )
  }
  return (
    <div className="flex flex-col items-center gap-1.5">
      <p role="status" className="text-center font-body text-sm text-muted">
        <span className="text-consequence">NUMBER LOCKED</span>
        {bothLocked ? ' — both numbers are in' : ` — waiting on ${opponent}`}
      </p>
      {bothLocked && onReveal && (
        <Button variant="ghost" className="px-4 py-1.5 text-sm" onClick={onReveal}>
          PLAY THE REVEAL →
        </Button>
      )}
    </div>
  )
}

/** The single commit screen: situation, matchup, and the blind number. */
export function DuelCommit({
  seat,
  matchup,
  situation,
  opponentLocked,
  onLock,
  onReveal,
  focusOnMount = false,
}: DuelCommitProps) {
  const [number, setNumber] = useState('')
  const [locked, setLocked] = useState(false)

  // The other seat's player: who the lock chip is about, and who this seat waits on.
  const other = committerOf(oppositeSeat(seat), situation)
  const board = scoreboardLines(situation)

  const handleLock = () => {
    onLock?.(Number(number))
    setLocked(true)
  }

  return (
    <DuelChrome clubs={situation.clubs}>
      <div className="flex flex-1 flex-col gap-3 px-5 pb-4">
        <Scoreboard
          away={board.away}
          home={board.home}
          inning={formatInning(situation)}
          outs={situation.outs}
        />
        <div className="flex items-stretch gap-3">
          <FieldDiagram
            runnersOn={liveFieldSpots(situation)}
            runners={situation.runners}
            className="h-36 w-36 shrink-0 self-center"
          />
          <MatchupCard {...matchup} />
        </div>
        <OtherSeatChip other={other} locked={opponentLocked} />
        <div className="text-center">
          <ScoreTileInput
            label={locked ? 'your number · locked' : 'your number'}
            value={number}
            onChange={setNumber}
            disabled={locked}
            focusOnMount={focusOnMount}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !locked && isValidDuelNumber(number)) handleLock()
            }}
          />
        </div>
        <CommitAction
          locked={locked}
          bothLocked={locked && opponentLocked}
          opponent={other.player}
          canLock={isValidDuelNumber(number)}
          onLock={handleLock}
          onReveal={onReveal}
        />
        <div className="mt-auto">
          <OutcomeLadder />
        </div>
      </div>
    </DuelChrome>
  )
}
