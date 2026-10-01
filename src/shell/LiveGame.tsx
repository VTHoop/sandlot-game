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
  RevealAdvance,
  revealAdvanceOf,
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
 * A game at `/game/:id` from its first pitch to its final (SAN-39, SAN-67): the
 * duel's screens, driven by the server (ADR-0031), carried across half
 * boundaries and on to the game-over screen (ADR-0032).
 *
 * Which screen shows is decided from three subscriptions and nothing else —
 * `getGame` for the situation and the locks, `getLastAtBat` for the reveal,
 * `getRevealsDismissedThrough` for which reveal this viewer has already
 * dismissed (SAN-22, ADR-0034; `../duel/liveDuel` holds the decisions). This
 * component owns only what the server cannot know: whether the viewer has moved
 * past a half's summary, and what to tell them when a commit did not land.
 * Crossing a half is not one of those — the server has already opened the next
 * half by the time its summary shows.
 *
 * It never resolves an at-bat, never holds a number that is not the viewer's
 * own, and commits one owned seat at a time through `commitPitch` /
 * `commitSwing`.
 */

/** A `dismissed` sequence below every real one: no at-bat has been watched. */
const NOTHING_RESOLVED = -1

/**
 * A dismissal that did not reach the server is let go. The screen has already
 * moved on, and the cost is one replay of that reveal on the next load — which
 * errs toward the reveal not being lost. Convex retries a mutation across
 * reconnects itself, so a rejection here is a refusal, which only a bug causes.
 */
function letDismissalGo(): void {
  // Deliberately nothing: see above.
}

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
  /** The viewer is done with this reveal; it is handed the at-bat it showed and
   * where advancing past it leads. */
  onAdvance: (shown: ResolvedAtBatView, advance: RevealAdvance) => void
}

/** The advance control's words for where it leads (`liveDuel.revealAdvanceOf`). */
function advanceLabelOf(advance: RevealAdvance): string {
  switch (advance) {
    case RevealAdvance.FinalScore:
      return 'FINAL SCORE →'
    case RevealAdvance.EndOfHalf:
      return 'END OF HALF →'
    case RevealAdvance.NextBatter:
      return 'NEXT BATTER →'
  }
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
  const advance = revealAdvanceOf(shown, atBat, game)
  return (
    <RevealMotion
      key={replayKey}
      scenario={scenario}
      onReplay={() => {
        setReplayKey((k) => k + 1)
      }}
      onAdvance={() => {
        onAdvance(shown, advance)
      }}
      advanceLabel={advanceLabelOf(advance)}
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

interface LiveGameScreensProps extends LiveGameProps {
  lastAtBat: ResolvedAtBatView | null
  /** The last at-bat this viewer has dismissed, on any device; null for none. */
  dismissedThrough: number | null
}

/**
 * The screens, once all three subscriptions have answered.
 *
 * `dismissed` is the later of what the server has on file and what this screen
 * has just dismissed, worked out on every render. The server's half means a
 * reveal the viewer left partway through is waiting when they return, and one
 * they dismissed on another device is gone here too, even on a screen that was
 * already open. The local half moves the screen on at once, without waiting for
 * the round trip. Both only rise, so the screen never goes back to a reveal.
 *
 * The same instance carries on when the game goes final under it, which is how
 * the game-ending at-bat is revealed before the game-over screen (SAN-67).
 */
function LiveGameScreens({ game, lastAtBat, dismissedThrough }: LiveGameScreensProps) {
  const dismissReveal = useMutation(api.revealDismissals.dismissReveal)
  const [watched, setWatched] = useState(NOTHING_RESOLVED)
  const dismissed = Math.max(dismissedThrough ?? NOTHING_RESOLVED, watched)
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
    const advance = (shown: ResolvedAtBatView, to: RevealAdvance) => {
      setWatched((prev) => Math.max(prev, shown.sequence))
      // The at-bat this reveal showed, not the latest: one that resolved while it
      // played is still to be revealed.
      dismissReveal({ game: game.id, sequence: shown.sequence }).catch(letDismissalGo)
      setNotice(null)
      // The card announces the half the server has opened, so it needs a live
      // game; once the game is final, what follows is its final reveal or
      // game-over, never a half card.
      if (to === RevealAdvance.EndOfHalf && game.status === GameStatus.Live) {
        setSummary(halfSummaryOf(shown, game))
      }
    }
    return (
      <DuelFrame notice={null}>
        {/* Keyed by what has been dismissed: advancing past one reveal — here or
            on another device — mounts a fresh one for whatever resolved while it
            played. */}
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
  const dismissedThrough = useQuery(api.revealDismissals.getRevealsDismissedThrough, {
    game: game.id,
  })
  // Neither answer alone says whether there is a reveal to show.
  if (lastAtBat === undefined || dismissedThrough === undefined) {
    return (
      <Screen>
        <Waiting>Loading the game…</Waiting>
      </Screen>
    )
  }
  return <LiveGameScreens game={game} lastAtBat={lastAtBat} dismissedThrough={dismissedThrough} />
}
