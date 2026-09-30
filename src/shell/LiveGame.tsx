import { GameStatus } from '@sandlot/engine/game'
import { useMutation, useQuery } from 'convex/react'
import { type ReactNode, useMemo, useState } from 'react'
import { api } from '../../convex/_generated/api'
import { duelRejectionOf, type ResolvedAtBatView } from '../../convex/duelContract'
import { DuelCommit } from '../duel/DuelCommit'
import type { HalfSummary } from '../duel/duelLoop'
import { HalfSummaryCard } from '../duel/HalfSummaryCard'
import {
  halfSummaryOf,
  type LiveGameView,
  matchupOf,
  type PlayedGameView,
  revealOf,
  sideChangeOf,
  situationOf,
  type Turn,
  TurnKind,
  turnFor,
} from '../duel/liveDuel'
import { RevealMotion } from '../duel/RevealMotion'
import { DuelSeat } from '../duel/seatAgent'
import { WaitingTurn } from '../duel/WaitingTurn'
import { GameOver } from './GameOver'
import { Screen, Waiting } from './Screen'
import '../duel/duel.css'

/**
 * A game at `/game/:id` from its first pitch to its final (SAN-39, SAN-67,
 * ADR-0031): the duel's screens, driven by the server, ending on the game-over
 * screen.
 *
 * Which screen shows is decided from two subscriptions and nothing else —
 * `getGame` for the situation and the locks, `getLastAtBat` for the reveal
 * (`../duel/liveDuel` holds the decisions). This component owns only what the
 * server cannot know: which reveal this viewer has already watched, whether
 * they have moved past a half's summary, and what to tell them when a commit
 * did not land. Crossing a half is not one of those — the server has already
 * opened the next half by the time its summary shows. It never resolves an at-bat, never holds
 * a number that is not the viewer's own, and commits one owned seat at a time
 * through `commitPitch` / `commitSwing`.
 */

/** A `dismissed` sequence below every real one: no at-bat has been watched. */
const NOTHING_RESOLVED = -1

const SEND_FAILED = 'Couldn’t send your number. Try again.'

/** The duel's frame in the app: a phone-width column the screens fill, with a
 * line above them for anything the viewer has to be told. */
function DuelFrame({ notice, children }: { notice: string | null; children: ReactNode }) {
  return (
    <main className="mx-auto flex h-dvh w-full max-w-md flex-col bg-linear-to-b from-canvas-high to-canvas">
      {notice && (
        <p role="alert" className="px-5 pt-3 text-center font-body text-sm text-consequence">
          {notice}
        </p>
      )}
      <div className="min-h-0 flex-1">{children}</div>
    </main>
  )
}

interface CommitTurnProps {
  game: LiveGameView
  turn: Extract<Turn, { kind: TurnKind.Commit }>
  /** Changes with each at-bat, so the same seat opens on an empty entry again. */
  atBatKey: number
  /** Tell the viewer why a commit did not land, or clear it once one does. */
  onNotice: (notice: string | null) => void
}

/**
 * One owned seat's commit. The number goes to the server and the screen waits
 * for the server to say what is next — it does not advance itself.
 *
 * A commit that does not land bumps `attempt`, which remounts the entry empty
 * and unlocked. For a refusal that is the re-sync: if the server already holds
 * this seat's number, its lock arrives on the subscription and the turn moves on
 * without this component doing anything.
 */
function CommitTurn({ game, turn, atBatKey, onNotice }: CommitTurnProps) {
  const commitPitch = useMutation(api.atBat.commitPitch)
  const commitSwing = useMutation(api.atBat.commitSwing)
  const [attempt, setAttempt] = useState(0)

  const commit = (number: number) => {
    const send = turn.seat === DuelSeat.Pitcher ? commitPitch : commitSwing
    send({ game: game.id, number }).then(
      () => {
        onNotice(null)
      },
      (error: unknown) => {
        // A refusal carries the server's own reason (ADR-0026); anything else is
        // the number not getting there.
        onNotice(duelRejectionOf(error)?.reason ?? SEND_FAILED)
        setAttempt((n) => n + 1)
      },
    )
  }

  return (
    <DuelCommit
      key={`${atBatKey}-${turn.seat}-${attempt}`}
      seat={turn.seat}
      matchup={matchupOf(game)}
      situation={situationOf(game)}
      opponentLocked={turn.opponentLocked}
      onLock={commit}
      focusOnMount
    />
  )
}

interface RevealTurnProps {
  atBat: ResolvedAtBatView
  game: PlayedGameView
  /** The viewer is done with this reveal; it is handed the at-bat it showed. */
  onAdvance: (shown: ResolvedAtBatView) => void
}

/**
 * Where a reveal's advance goes. The game-ending at-bat is the one that is
 * latest once the game is final — a walk-off ends no half by outs, so the half
 * flag alone cannot tell it apart.
 */
function advanceLabelOf(shown: ResolvedAtBatView, latest: ResolvedAtBatView, game: PlayedGameView) {
  if (game.status === GameStatus.Final && shown.sequence === latest.sequence) return 'FINAL SCORE →'
  return shown.endedHalf ? 'END OF HALF →' : 'NEXT BATTER →'
}

/**
 * The reveal of a resolved at-bat, rendered from the server's record of it.
 *
 * It pins the at-bat it opened on. `getLastAtBat` moves on whenever a newer one
 * resolves — from another tab or device on the same account, since nothing
 * resolves without the viewer's own commit — and a reveal must not turn into a
 * different play part-way through. The caller re-keys this component to reveal
 * the newer at-bat afterwards.
 */
function RevealTurn({ atBat, game, onAdvance }: RevealTurnProps) {
  const [shown] = useState(atBat)
  const [replayKey, setReplayKey] = useState(0)
  const { home, away } = game
  const scenario = useMemo(() => revealOf(shown, { home, away }), [shown, home, away])
  return (
    <RevealMotion
      key={replayKey}
      scenario={scenario}
      onReplay={() => {
        setReplayKey((k) => k + 1)
      }}
      onAdvance={() => {
        onAdvance(shown)
      }}
      advanceLabel={advanceLabelOf(shown, atBat, game)}
    />
  )
}

/** The at-bat now open: a seat to commit for, or a wait on one the viewer does
 * not drive. */
function OpenAtBat({ game, atBatKey, onNotice }: Omit<CommitTurnProps, 'turn'>) {
  const turn = turnFor(game)
  if (turn.kind === TurnKind.Commit) {
    return <CommitTurn game={game} turn={turn} atBatKey={atBatKey} onNotice={onNotice} />
  }
  return <WaitingTurn situation={situationOf(game)} waitingOn={turn.waitingOn} />
}

interface LiveGameProps {
  game: PlayedGameView
}

/**
 * The screens, once both subscriptions have answered. `dismissed` opens on the
 * at-bat already on the books, so loading the page never replays it: the viewer
 * lands on the at-bat that is open (SAN-39's "whose turn is unambiguous on
 * load") — or, for a finished game, on the game-over screen. An at-bat that
 * resolves after that is one they have not seen.
 *
 * The same instance carries on when the game goes final under it, which is how
 * the game-ending at-bat is revealed before the game-over screen (SAN-67): the
 * screen does not remount, so that at-bat is still one this viewer has not seen.
 */
function LiveGameScreens({
  game,
  lastAtBat,
}: LiveGameProps & { lastAtBat: ResolvedAtBatView | null }) {
  const [dismissed, setDismissed] = useState(lastAtBat?.sequence ?? NOTHING_RESOLVED)
  const [summary, setSummary] = useState<HalfSummary | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  // A half is over: its summary, and the side change into the half the server
  // has already opened. It stays until the viewer continues.
  if (summary && game.status === GameStatus.Live) {
    const next = {
      change: sideChangeOf(game),
      onContinue: () => {
        setSummary(null)
      },
    }
    return (
      <DuelFrame notice={null}>
        <HalfSummaryCard summary={summary} next={next} />
      </DuelFrame>
    )
  }

  if (lastAtBat && lastAtBat.sequence > dismissed) {
    const advance = (shown: ResolvedAtBatView) => {
      setDismissed(shown.sequence)
      setNotice(null)
      // No half card after the game's last half: the game-over screen follows.
      if (shown.endedHalf && game.status === GameStatus.Live) setSummary(halfSummaryOf(shown))
    }
    return (
      <DuelFrame notice={null}>
        {/* Keyed by what has been dismissed: advancing past one reveal mounts a
            fresh one for whatever resolved while it played. */}
        <RevealTurn key={dismissed} atBat={lastAtBat} game={game} onAdvance={advance} />
      </DuelFrame>
    )
  }

  if (game.status === GameStatus.Final) return <GameOver game={game} />

  return (
    <DuelFrame notice={notice}>
      <OpenAtBat game={game} atBatKey={dismissed} onNotice={setNotice} />
    </DuelFrame>
  )
}

export default function LiveGame({ game }: LiveGameProps) {
  const lastAtBat = useQuery(api.atBatView.getLastAtBat, { game: game.id })
  if (lastAtBat === undefined) {
    return (
      <Screen>
        <Waiting>Loading the game…</Waiting>
      </Screen>
    )
  }
  return <LiveGameScreens game={game} lastAtBat={lastAtBat} />
}
