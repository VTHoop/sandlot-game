import { Scoreboard } from '../components/ui/Scoreboard'
import { DuelChrome } from './DuelChrome'
import { FieldDiagram } from './FieldDiagram'
import {
  committerOf,
  type DuelSituation,
  formatInning,
  liveFieldSpots,
  scoreboardLines,
} from './scenario'
import type { DuelSeat } from './seatAgent'

interface WaitingTurnProps {
  situation: DuelSituation
  /** The seat whose number is still out. */
  waitingOn: DuelSeat
}

/**
 * The between-turns state: calm, ambient, no actions to take. It says whose
 * number is still out by naming the player and what they owe, and addresses
 * nobody as "you" — the same screen is true for either club (SAN-39).
 */
export function WaitingTurn({ situation, waitingOn }: WaitingTurnProps) {
  const awaited = committerOf(waitingOn, situation)
  const board = scoreboardLines(situation)
  return (
    <DuelChrome clubs={situation.clubs}>
      <div className="relative flex flex-1 flex-col items-center gap-6 px-5 pt-6 pb-5">
        <span className="duel-firefly top-32 left-8" />
        <span className="duel-firefly top-52 right-10" style={{ animationDelay: '3s' }} />
        <span className="duel-firefly bottom-24 left-14" style={{ animationDelay: '6s' }} />
        <Scoreboard
          away={board.away}
          home={board.home}
          inning={formatInning(situation)}
          outs={situation.outs}
        />
        <FieldDiagram runnersOn={liveFieldSpots(situation)} />
        <p className="text-center font-display text-xl tracking-wider text-chalk">
          {`WAITING ON ${awaited.player.toUpperCase()}’S ${awaited.act.toUpperCase()}`}
        </p>
        <p className="flex items-center gap-2 text-center font-body text-sm text-muted">
          <span className="duel-waiting-pulse size-2 rounded-full bg-consequence" />
          The reveal plays once both numbers are in
        </p>
      </div>
    </DuelChrome>
  )
}
