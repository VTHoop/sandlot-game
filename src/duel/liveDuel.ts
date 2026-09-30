import { GameStatus, Half } from '@sandlot/engine/game'
import type { ResolvedAtBatView } from '../../convex/duelContract'
import type { BasesView, ClubView, GameView } from '../../convex/gameView'
import { buildMatchup, buildReveal, halfLabel } from './adapter'
import { clubLabels, toRosterPlayer } from './convexAdapter'
import type { HalfSummary } from './duelLoop'
import type { DuelMatchup } from './MatchupCard'
import { type DuelSituation, FieldSpot, type RevealScenario, type RunnerOnBase } from './scenario'
import { DuelSeat } from './seatAgent'

/**
 * The server-driven duel's pure half (SAN-39, ADR-0031): everything `/game/:id`
 * decides, as functions of what the server reports. No React, no I/O, no state.
 *
 * The screen reads two subscriptions — `getGame` (the situation and the locks)
 * and `getLastAtBat` (the reveal) — and these functions turn them into whose
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

/** The end-of-half card for the half this at-bat closed, from the server's totals. */
export function halfSummaryOf(atBat: ResolvedAtBatView): HalfSummary {
  return {
    half: halfLabel(atBat.half),
    inning: atBat.inning,
    runs: atBat.halfTotals.runs,
    hits: atBat.halfTotals.hits,
  }
}
