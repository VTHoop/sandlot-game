import { GameStatus, Half } from '@sandlot/engine/game'
import type { ResolvedAtBatView } from '../../convex/duelContract'
import type { BasesView, ClubView, GameView } from '../../convex/gameView'
import { buildMatchup, buildReveal, halfLabel } from './adapter'
import { clubLabels, toRosterPlayer } from './convexAdapter'
import type { HalfSummary } from './duelLoop'
import type { DuelMatchup } from './MatchupCard'
import {
  type DuelSituation,
  FieldSpot,
  type RevealScenario,
  type RunnerOnBase,
  scoreAfter,
} from './scenario'
import { DuelSeat } from './seatAgent'

/**
 * The server-driven duel's pure half (SAN-39, ADR-0031): everything `/game/:id`
 * decides, as functions of what the server reports. No React, no I/O, no state.
 *
 * The screen reads three subscriptions — `getGame` (the situation and the
 * locks), `getLastAtBat` (the reveal) and `getRevealsDismissedThrough` (which
 * reveal this viewer has dismissed; ADR-0034) — and these functions turn the
 * first two into whose
 * turn it is and the view-models the duel's screens render. Nothing here
 * remembers anything: whose turn it is comes from the locks the server holds, so
 * a reload, a bot that commits first, and a second device all land on the right
 * screen for the same reason.
 *
 * It reuses the builders the fixture and hotseat paths render through
 * (`buildReveal`, `buildMatchup`), so the three agree on what a reveal and a
 * matchup are. It does not use `playHalfInning` or `createConvexDuelAdapter`:
 * that loop drives both seats from one client, which a real game does not have.
 */

/** A live game as the read model returns it. */
export type LiveGameView = Extract<GameView, { status: GameStatus.Live }>

/** A finished game as the read model returns it. */
export type FinalGameView = Extract<GameView, { status: GameStatus.Final }>

/** A game that has been played at all: `/game/:id`'s duel screens, from the first
 * pitch through the game-over screen they end on. */
export type PlayedGameView = LiveGameView | FinalGameView

/** What this client should be doing about the at-bat now open. */
export enum TurnKind {
  /** A seat this viewer drives has not locked: ask them for its number. */
  Commit = 'commit',
  /** Nothing for this viewer to commit: a seat they do not drive is still out. */
  Waiting = 'waiting',
}

export type Turn =
  | {
      kind: TurnKind.Commit
      seat: DuelSeat
      /** Whether the OTHER seat has locked — never its number (ADR-0014). */
      opponentLocked: boolean
    }
  | { kind: TurnKind.Waiting; waitingOn: DuelSeat }

/** One seat of the at-bat now open, as far as the turn is concerned. */
interface OpenSeat {
  seat: DuelSeat
  /** Whether the viewer owns the club in this seat. */
  driven: boolean
  locked: boolean
}

/**
 * Both seats, pitcher first. The away club bats the top half and the home club
 * the bottom (SAN-21), so which club is in which seat follows the half.
 */
function seatsOf(view: Pick<LiveGameView, 'half' | 'locks' | 'viewerOwns'>): [OpenSeat, OpenSeat] {
  const { half, locks, viewerOwns } = view
  const awayBats = half === Half.Top
  return [
    {
      seat: DuelSeat.Pitcher,
      driven: awayBats ? viewerOwns.home : viewerOwns.away,
      locked: locks.pitchCommitted,
    },
    {
      seat: DuelSeat.Batter,
      driven: awayBats ? viewerOwns.away : viewerOwns.home,
      locked: locks.swingCommitted,
    },
  ]
}

/**
 * Whose turn it is, for this viewer, from server state alone.
 *
 * The viewer drives exactly the seats whose clubs they own: one, usually, or
 * both for the one-account hotseat (ADR-0028), who is asked for the pitch and
 * then the swing. A seat that has already locked is never asked for again, and
 * either seat may lock first (ADR-0014) — the bot usually has.
 *
 * It takes `viewerOwns`, the half and the locks, and deliberately not `viewer`
 * or `viewerSeat`: those name ONE side and one seat, and resolve an owner of
 * both clubs to the home club's — which would never prompt them for the other.
 */
export function turnFor(view: Pick<LiveGameView, 'half' | 'locks' | 'viewerOwns'>): Turn {
  const [pitcher, batter] = seatsOf(view)
  if (pitcher.driven && !pitcher.locked) {
    return { kind: TurnKind.Commit, seat: DuelSeat.Pitcher, opponentLocked: batter.locked }
  }
  if (batter.driven && !batter.locked) {
    return { kind: TurnKind.Commit, seat: DuelSeat.Batter, opponentLocked: pitcher.locked }
  }
  // Both locked is momentary — the server resolves on the second commit — and
  // reads as waiting on the swing until the reveal arrives.
  return { kind: TurnKind.Waiting, waitingOn: pitcher.locked ? DuelSeat.Batter : DuelSeat.Pitcher }
}

/** Every runner on base, in lead order (third → first), by name. Explicit reads,
 * one per base — no computed member access (AGENTS.md). */
function runnersOf(bases: BasesView): RunnerOnBase[] {
  const runners: RunnerOnBase[] = []
  if (bases.third) runners.push({ spot: FieldSpot.Third, name: bases.third.name })
  if (bases.second) runners.push({ spot: FieldSpot.Second, name: bases.second.name })
  if (bases.first) runners.push({ spot: FieldSpot.First, name: bases.first.name })
  return runners
}

/**
 * The non-secret situation the commit and waiting screens show, read straight
 * off the server's view. Absolute, like the view (ADR-0030), and structurally
 * free of both duel numbers: the view carries lock booleans and no number, and
 * `DuelSituation` has no slot for one.
 */
export function situationOf(view: LiveGameView): DuelSituation {
  const runners = runnersOf(view.bases)
  return {
    pitcher: view.pitcher.name,
    batter: view.batter.name,
    clubs: clubLabels(view),
    inning: view.inning,
    half: halfLabel(view.half),
    outs: view.outs,
    scoreBefore: { away: view.score.away, home: view.score.home },
    hitsBefore: { away: view.hits.away, home: view.hits.home },
    runnersOn: runners.map((runner) => runner.spot),
    runners,
  }
}

/** The matchup card: the seated pitcher and batter, and who is due up. */
export function matchupOf(view: LiveGameView): DuelMatchup {
  return buildMatchup(
    toRosterPlayer(view.pitcher),
    toRosterPlayer(view.batter),
    view.dueUp.map((player) => player.name),
  )
}

/**
 * The reveal for a resolved at-bat, built from the server's record of it and
 * nothing the client held — so it is the same reveal after a reload, and the
 * client never resolves anything (ADR-0016). Goes through `buildReveal`, the
 * builder the fixture path uses, handed the state as it stood before the play.
 */
export function revealOf(
  atBat: ResolvedAtBatView,
  clubs: { away: ClubView; home: ClubView },
): RevealScenario {
  return buildReveal({
    pitch: atBat.pitchNumber,
    swing: atBat.batterNumber,
    state: {
      status: GameStatus.Live,
      inning: atBat.inning,
      half: atBat.half,
      outs: atBat.outsBefore,
      bases: atBat.basesBefore,
      homeScore: atBat.scoreBefore.home,
      awayScore: atBat.scoreBefore.away,
      currentBatter: atBat.batter.id,
      currentPitcher: atBat.pitcher.id,
    },
    resolved: atBat,
    players: { batter: atBat.batter, pitcher: atBat.pitcher.name },
    board: {
      clubs: clubLabels(clubs),
      hits: { away: atBat.hitsBefore.away, home: atBat.hitsBefore.home },
    },
  })
}

/** Where advancing past a reveal leads. */
export enum RevealAdvance {
  /** The next at-bat — or the next reveal, if another resolved meanwhile. */
  NextBatter = 'next-batter',
  /** The half's summary. */
  EndOfHalf = 'end-of-half',
  /** The game-over screen. */
  FinalScore = 'final-score',
}

/**
 * Where advancing past the reveal of `shown` leads, given the latest resolved
 * at-bat and the game's status (SAN-67, ADR-0032).
 *
 * The game-ending at-bat is the latest one of a final game. The half flag
 * cannot say so — a walk-off ends no half by outs — and neither can the status
 * alone: from a second tab or device the game can go final while an older
 * reveal is still on screen, and the at-bat that ended it is then revealed next.
 */
export function revealAdvanceOf(
  shown: ResolvedAtBatView,
  latest: ResolvedAtBatView,
  game: Pick<PlayedGameView, 'status'>,
): RevealAdvance {
  if (game.status === GameStatus.Final && shown.sequence === latest.sequence) {
    return RevealAdvance.FinalScore
  }
  return shown.endedHalf ? RevealAdvance.EndOfHalf : RevealAdvance.NextBatter
}

/** The half now open and the club batting in it. */
export interface SideChange {
  inning: number
  half: ReturnType<typeof halfLabel>
  /** The batting club's name. */
  batting: string
}

/**
 * The side change the end-of-half card announces: the half now open and the club
 * batting in it. Read off the server's live state, which has already turned the
 * half over by the time the card shows (ADR-0017) — never counted forward from
 * the half that ended.
 */
export function sideChangeOf(view: LiveGameView): SideChange {
  return {
    inning: view.inning,
    half: halfLabel(view.half),
    batting: view.half === Half.Top ? view.away.name : view.home.name,
  }
}

/** The end-of-half card for the half this at-bat closed, from the server's record of it. */
export function halfSummaryOf(
  atBat: ResolvedAtBatView,
  clubs: { away: ClubView; home: ClubView },
): HalfSummary {
  const half = halfLabel(atBat.half)
  return {
    half,
    inning: atBat.inning,
    runs: atBat.halfTotals.runs,
    hits: atBat.halfTotals.hits,
    clubs: clubLabels(clubs),
    // From the at-bat, not the live score: the card is about the half this
    // at-bat closed, whatever has resolved since.
    score: scoreAfter({ half, scoreBefore: atBat.scoreBefore, runsScored: atBat.runsScored }),
  }
}
