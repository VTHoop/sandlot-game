import { useState } from 'react'
import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'
import { OutcomeLadder } from '../../components/ui/OutcomeLadder'
import { Scoreboard } from '../../components/ui/Scoreboard'
import { ScoreTileInput } from '../../components/ui/ScoreTileInput'
import { DuelChrome } from './DuelChrome'
import { isValidDuelNumber } from './duelNumber'
import { FieldDiagram } from './FieldDiagram'
import { type DuelMatchup, MatchupCard } from './MatchupCard'
import { type DuelSituation, formatInning } from './scenario'

interface DuelCommitProps {
  /** Which seat the viewer holds; the screen is otherwise identical. */
  seat: 'pitcher' | 'batter'
  /** Both managers' players; the screen orients them for this seat. */
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
  opponentOnline: boolean
  /** Surfaces this seat's committed number to the parent when it locks. */
  onLock?: (committed: number) => void
  onReveal?: () => void
  /** Focus the number entry on mount — set when a seat-transition remount should
   * hand the keyboard straight to this seat (see `ScoreTileInput.focusOnMount`). */
  focusOnMount?: boolean
}

/**
 * Orient the two-sided matchup + half for the seat the viewer holds. The viewer
 * is cast as the home team: they bat in the bottom half and pitch in the top, so
 * the two seats depict different half-innings and flip who throws vs. swings.
 */
function orientSeat(seat: DuelCommitProps['seat'], players: DuelMatchup, situation: DuelSituation) {
  if (seat === 'batter') {
    return {
      half: situation.half,
      matchup: {
        pitcher: players.opponent.pitcher,
        batter: players.you.batter,
        dueUp: players.you.dueUp,
      },
    }
  }
  return {
    half: 'TOP' as const,
    matchup: {
      pitcher: players.you.pitcher,
      batter: players.opponent.batter,
      dueUp: players.opponent.dueUp,
    },
  }
}

/** The persistent status chip: THAT the opponent has locked, never the number. */
function OpponentNumberChip({ opponent, locked }: { opponent: string; locked: boolean }) {
  return (
    <Card className="flex items-center justify-between px-4 py-2">
      <span className="font-body text-[11px] tracking-[0.22em] text-muted uppercase">
        {opponent}&rsquo;s number
      </span>
      <span className="font-display text-sm tracking-wider text-chalk">
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
      {bothLocked && (
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
  matchup: players,
  situation,
  opponentLocked,
  opponentOnline,
  onLock,
  onReveal,
  focusOnMount = false,
}: DuelCommitProps) {
  const [number, setNumber] = useState('')
  const [locked, setLocked] = useState(false)

  const opponent = situation.opponent
  const { half, matchup } = orientSeat(seat, players, situation)

  return (
    <DuelChrome opponent={opponent} opponentOnline={opponentOnline}>
      <div className="flex flex-1 flex-col gap-3 px-5 pb-4">
        <Scoreboard
          away={{
            label: opponent.slice(0, 3).toUpperCase(),
            runs: situation.scoreBefore.opp,
            hits: situation.hitsBefore.opp,
          }}
          home={{ label: 'YOU', runs: situation.scoreBefore.you, hits: situation.hitsBefore.you }}
          inning={formatInning({ inning: situation.inning, half })}
          outs={situation.outs}
        />
        <div className="flex items-stretch gap-3">
          <FieldDiagram className="h-36 w-36 shrink-0 self-center" />
          <MatchupCard {...matchup} />
        </div>
        <OpponentNumberChip opponent={opponent} locked={opponentLocked} />
        <div className="text-center">
          <ScoreTileInput
            label={locked ? 'your number · locked' : 'your number'}
            value={number}
            onChange={setNumber}
            disabled={locked}
            focusOnMount={focusOnMount}
          />
        </div>
        <CommitAction
          locked={locked}
          bothLocked={locked && opponentLocked}
          opponent={opponent}
          canLock={isValidDuelNumber(number)}
          onLock={() => {
            onLock?.(Number(number))
            setLocked(true)
          }}
          onReveal={onReveal}
        />
        <div className="mt-auto">
          <OutcomeLadder />
        </div>
      </div>
    </DuelChrome>
  )
}
