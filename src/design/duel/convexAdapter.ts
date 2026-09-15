import {
  baseRunningSpeed,
  DUEL_MAX,
  DUEL_MIN,
  type HitterAttributes,
  isDuelNumber,
  type PitcherAttributes,
} from '@sandlot/engine/atBat'
import { GameStatus } from '@sandlot/engine/game'
import {
  type DuelCommitResult,
  DuelRejection,
  type DuelRejectionData,
  DuelStatus,
  type DuelView,
  duelRejectionOf,
} from '../../../convex/duelContract'
import type { ClubTotals, GameView, PlayerView, SeatView } from '../../../convex/gameView'
import {
  buildMatchup,
  buildReveal,
  byBattingSide,
  type DuelAdapter,
  type DuelResolution,
  type DuelState,
  type ResolvedFacts,
  SeatedRole,
  seated,
} from './adapter'
import type { DuelMatchup } from './MatchupCard'
import type { Roster, RosterPlayer } from './roster'
import { DuelSeat } from './seatAgent'

/**
 * The Convex-backed duel adapter (SAN-57): the second implementation of
 * `DuelAdapter`, driven by the same `playHalfInning` loop and rendering through
 * the same components as the in-memory one. `duelLoop` never branches on which
 * it holds.
 *
 * AUTHORITY — this module resolves nothing. A committed number goes to
 * `commitPitch` / `commitSwing`, the server reads both, resolves through the
 * engine, appends the log and advances the live row in one transaction, and the
 * reveal is built from the outcome it hands back (ADR-0016, AGENTS.md game
 * integrity). The sibling `adapter.ts` keeps the read-only engine call ADR-0009
 * permits, for previews — never as the source of a result. Nothing here calls it.
 *
 * WHAT IT CACHES, AND WHY THAT MATTERS. `state()` and `hits()` are synchronous
 * because the loop reads them between awaits; they answer from a snapshot this
 * module holds. `playAtBat` is therefore not done when the mutation returns — it
 * must install the snapshot the at-bat produced before it settles, because the
 * loop re-reads `state()` twice immediately afterwards (`duelLoop.ts`) and a
 * pre-commit read there would re-seat the same batter and commit the at-bat a
 * second time. It confirms rather than assumes: the refreshed duel view has to
 * report the very ordinal the commit resolved, or this throws — loudly and
 * uncategorised, because by then the commit has already succeeded.
 *
 * PERSPECTIVE — the server answers absolutely (home/away, ADR-0025) and the
 * split to `you`/`opp` happens here, off the batting side, through the same
 * `byBattingSide` the fixture path uses for scores. So the two agree across a
 * half boundary without this module keeping a running total of its own. "You" is
 * still the batter, as it is throughout `adapter.ts`; keying it off `viewer`
 * instead belongs to SAN-39, which owns the first screen with a real viewer.
 *
 * NETWORK FAILURE IS NOT MODELLED HERE. The Convex client retries a mutation
 * across a dropped connection, so the only final failures are the application
 * errors thrown inside one — the categorised rejections below. Anything else
 * propagates untouched rather than being dressed up as a game rule.
 */

/**
 * The Convex surface one duel needs, with the game id already bound: the live
 * read model, the reveal query, and one mutation per seat.
 *
 * A port rather than a direct `ConvexReactClient` dependency, for two reasons.
 * It keeps this module free of React so the loop stays drivable headlessly, and
 * it is the seam SAN-22 replaces with a subscription — a pushed snapshot
 * installs through {@link ConvexDuelAdapter.refresh} exactly as a re-read does.
 */
export interface DuelGateway {
  readGame(): Promise<GameView | null>
  readDuel(): Promise<DuelView | null>
  commitPitch(number: number): Promise<DuelCommitResult>
  commitSwing(number: number): Promise<DuelCommitResult>
}

/**
 * A commit the server refused, carrying the category it refused with. The
 * category is a field rather than something to read out of the message, which is
 * the whole point of `DuelRejection` — see it for what each one means, and note
 * that neither is normal flow. The loop holds no retry logic; recovering from a
 * re-enterable rejection is the commit screen's job (SAN-22).
 */
export class DuelCommitError extends Error {
  readonly rejection: DuelRejection

  constructor(data: DuelRejectionData) {
    super(data.reason)
    this.name = 'DuelCommitError'
    this.rejection = data.rejection
  }
}

/**
 * The Convex-backed adapter: a `DuelAdapter`, plus the handles a duel screen
 * needs from the boundary that resolved them rather than from a local fixture.
 */
export interface ConvexDuelAdapter extends DuelAdapter {
  playAtBat(pitch: number, swing: number): Promise<DuelResolution>
  /**
   * The roster handle `playHalfInning` takes. One live map, not a copy per call:
   * the loop captures it once and holds it for the whole half, so the boundary
   * keeps it current as the seats change (a new batter each at-bat, and both
   * seats when the half turns). Handed out `ReadonlyMap`, so only this module
   * writes it.
   */
  roster(): Roster
  /** The matchup card's two sides, due up included, from the cached snapshot. */
  matchup(): DuelMatchup
  /**
   * Install a fresh server snapshot. The re-read `playAtBat` already performs,
   * exposed because a subscription-driven caller (SAN-22) pushes updates through
   * the same door.
   */
  refresh(): Promise<void>
}

// ─── Boundary mapping (read model → the shapes the duel screens want) ────────

/** A live game as the read model returns it. */
type LiveGameView = Extract<GameView, { status: GameStatus.Live }>

/**
 * One player resolved for the client: the display name the screens show, the
 * attribute block the matchup card reads, and the base-running speed derived
 * from that block — a pitcher-as-runner forced to the slowest (1, SAN-16), the
 * same default `convex/atBat.ts` applies where it feeds the engine.
 *
 * This is the roster resolution the AC places at the Convex boundary: the engine
 * is handed attributes and speeds, never a roster handle (ADR-0009).
 */
function toRosterPlayer(seat: SeatView): RosterPlayer {
  const attributes: HitterAttributes | PitcherAttributes = seat.attributes
  return { name: seat.name, attributes, speed: baseRunningSpeed(attributes) }
}

const runnerId = (runner: PlayerView | null) => runner?.id ?? null

/** The live view as the engine-shaped state the duel screens read. */
function toDuelState(view: LiveGameView): DuelState {
  return {
    status: GameStatus.Live,
    inning: view.inning,
    half: view.half,
    outs: view.outs,
    bases: {
      first: runnerId(view.bases.first),
      second: runnerId(view.bases.second),
      third: runnerId(view.bases.third),
    },
    homeScore: view.score.home,
    awayScore: view.score.away,
    currentBatter: view.batter.id,
    currentPitcher: view.pitcher.id,
  }
}

/** Everything the adapter answers `state()` / `hits()` / `matchup()` from. */
interface Snapshot {
  state: DuelState
  /** Absolute, as the server sends them — split by half on the way out. */
  hits: ClubTotals
  dueUp: readonly string[]
}

function liveSnapshot(view: LiveGameView): Snapshot {
  return {
    state: toDuelState(view),
    hits: view.hits,
    dueUp: view.dueUp.map((player) => player.name),
  }
}

/**
 * The snapshot a finished game leaves behind. The final variant carries no
 * inning, outs, bases or seats — a finished game has none (ADR-0025) — so the
 * last live snapshot stands where it stopped, with the authoritative final score
 * written over it and nobody seated. That is exactly the shape the engine's own
 * `finalize` produces, so the loop's `sameHalf` guard ends the half here for the
 * same reason on both paths.
 */
function finalSnapshot(previous: Snapshot, score: ClubTotals, hits: ClubTotals): Snapshot {
  return {
    state: {
      ...previous.state,
      status: GameStatus.Final,
      homeScore: score.home,
      awayScore: score.away,
      currentBatter: null,
      currentPitcher: null,
    },
    hits,
    dueUp: [],
  }
}

// ─── Reading the server's resolved at-bat ───────────────────────────────────

/** A resolved duel as the reveal needs it: the facts plus the two numbers. */
interface RevealedDuel extends ResolvedFacts {
  pitch: number
  swing: number
}

/**
 * The duel view for exactly this ordinal, resolved, or refuse. A view reporting
 * a DIFFERENT ordinal means the read did not reflect the at-bat just committed,
 * which is the one thing `playAtBat` must not return under — it would hand the
 * loop a pre-commit snapshot and have it commit the at-bat twice.
 *
 * Deliberately NOT a {@link DuelCommitError}. That taxonomy describes a commit
 * the server refused, and this commit succeeded — the at-bat is written. Calling
 * it *terminal* would claim the commit cannot succeed as posed, which is false;
 * calling it *re-enterable* would invite committing an at-bat that already
 * landed. A plain throw is the honest report, and the loop is right to stop on
 * it: `useDuelPlay` surfaces it as an error view, and re-opening the adapter
 * re-reads the ordinal the server actually holds.
 */
function resolvedAt(view: DuelView | null, sequence: number): DuelView {
  if (view?.status === DuelStatus.Resolved && view.sequence === sequence) return view
  throw new Error(
    `Read back duel ${view?.sequence ?? 'none'} (${view?.status ?? 'unreadable'}) after resolving at-bat ${sequence}`,
  )
}

/**
 * One part of a resolved at-bat, or refuse. Every field is optional on
 * `DuelView` because the same shape reports an unresolved duel, so a resolved
 * one missing any of them is corrupt state rather than a case to render around.
 */
function part<T>(value: T | undefined, name: string, sequence: number): T {
  if (value === undefined) throw new Error(`Resolved at-bat ${sequence} is missing ${name}`)
  return value
}

/** The server's resolved at-bat, in the shape the reveal is built from. */
function revealedDuel(view: DuelView | null, sequence: number): RevealedDuel {
  const duel = resolvedAt(view, sequence)
  const need = <T>(value: T | undefined, name: string): T => part(value, name, sequence)
  return {
    pitch: need(duel.pitchNumber, 'the pitch thrown'),
    swing: need(duel.batterNumber, 'the swing taken'),
    outcome: need(duel.outcome, 'its outcome'),
    // Null for every band but GB — absence and "not a ground ball" are the same
    // fact here, which is why this one needs no refusal.
    groundBallResult: duel.groundBallResult ?? null,
    runsScored: need(duel.runsScored, 'the runs it scored'),
    outsAfter: need(duel.outsAfter, 'the out total it left'),
    basesAfter: need(duel.basesAfter, 'the bases it left'),
  }
}

/** Re-throw a refused commit with its category attached, and leave anything else
 * exactly as it was — see the module header on network failure. */
function asCommitError(error: unknown): unknown {
  const rejection = duelRejectionOf(error)
  return rejection ? new DuelCommitError(rejection) : error
}

async function commit(send: () => Promise<DuelCommitResult>): Promise<DuelCommitResult> {
  try {
    return await send()
  } catch (error) {
    throw asCommitError(error)
  }
}

/**
 * Who this at-bat is between, or refuse. A snapshot that is not live, or one
 * with an empty seat, is not an at-bat waiting to be played — and committing
 * against it would ask the player to pick a number for a matchup that is not
 * there.
 */
function requireAtBat(
  snapshot: Snapshot,
  players: ReadonlyMap<string, RosterPlayer>,
): { batter: string; opponent: string } {
  const { status, currentBatter, currentPitcher } = snapshot.state
  if (status !== GameStatus.Live) {
    throw new Error('The game is not live, so there is no at-bat to play')
  }
  return {
    batter: seated(players, currentBatter, SeatedRole.Batter).id,
    opponent: seated(players, currentPitcher, SeatedRole.Pitcher).player.name,
  }
}

/**
 * The pair one at-bat is committed with. They travel together because they are
 * only ever validated and sent together — see {@link assertCommittable} for why
 * splitting them is the failure this type exists to prevent.
 */
interface DuelNumbers {
  pitch: number
  swing: number
}

/** The seat whose number the ring cannot hold, or null. Reuses the loop's own
 * `DuelSeat` rather than minting a second two-value vocabulary for the same
 * pair. Explicit reads, one per line — a seat→number table would only relocate
 * the problem. */
function outOfRing(numbers: DuelNumbers): DuelSeat | null {
  if (!isDuelNumber(numbers.pitch)) return DuelSeat.Pitcher
  if (!isDuelNumber(numbers.swing)) return DuelSeat.Batter
  return null
}

/**
 * Refuse a number the ring cannot hold, before either seat is committed.
 *
 * Not a second validator: this is `isDuelNumber`, the same rule the server
 * applies (AGENTS.md — one layer owns a domain), and the server still applies it
 * independently. Checking BOTH numbers up front is what keeps the pair atomic. A
 * swing rejected *after* the pitch is on file leaves a half-committed at-bat
 * this adapter cannot finish: the ordinal now holds a pitching commitment, so
 * every later attempt at it is refused as already-locked, corrected swing and
 * all.
 *
 * Reaching this means the commit screen was bypassed — a bug signal, not normal
 * flow — so it carries the same re-enterable category the server would have.
 */
function assertCommittable(numbers: DuelNumbers): void {
  const seat = outOfRing(numbers)
  if (seat) {
    throw new DuelCommitError({
      rejection: DuelRejection.ReEnterable,
      reason: `The ${seat}'s number must be a whole number in ${DUEL_MIN}–${DUEL_MAX}`,
    })
  }
}

/**
 * Seal both seats and return the at-bat the server resolved.
 *
 * Order-independent (ADR-0014): the server resolves on whichever commit
 * completes the pair, so the PITCH may resolve it if a swing is already on file.
 * Hotseat drives both seats, so that means someone locked out of band — and the
 * swing being held would have no ordinal left to land on. Committing it anyway
 * would seal the NEXT at-bat with a number nobody chose for it, which is why
 * this refuses instead of carrying on.
 *
 * A half-committed at-bat is still reachable, just no longer by the one cause
 * that is routine: a seat emptied or a club re-pointed *between* the two commits
 * leaves the pitch on file with no way to finish the at-bat here. That window is
 * genuinely concurrent and recovering from it needs the lock state and a screen
 * to show it — SAN-22's, not this module's. What this module must not do is
 * quietly skip a locked seat: the caller hands both numbers on every call, so
 * resolving against a stored pitch instead of the one just passed would show a
 * player a result for a number they did not commit.
 */
async function commitBothSeats(
  gateway: DuelGateway,
  numbers: DuelNumbers,
): Promise<NonNullable<DuelCommitResult>> {
  assertCommittable(numbers)

  const early = await commit(() => gateway.commitPitch(numbers.pitch))
  if (early) {
    throw new Error(
      `At-bat ${early.sequence} resolved on the pitch commit; the swing has no at-bat to join`,
    )
  }
  const resolution = await commit(() => gateway.commitSwing(numbers.swing))
  if (!resolution) throw new Error('Both numbers are on file but the server resolved no at-bat')
  return resolution
}

// ─── The adapter ────────────────────────────────────────────────────────────

/**
 * Open the adapter on a game, reading its opening snapshot before returning — so
 * the loop's very first synchronous `state()` has a real situation to answer
 * with rather than an empty one it would discover was wrong later.
 *
 * The game must be live. A finished one has no at-bat left to play, and a
 * scheduled one has no seats to commit for; `startGame` is the caller's move,
 * not this module's.
 */
export async function createConvexDuelAdapter(gateway: DuelGateway): Promise<ConvexDuelAdapter> {
  const opening = await requireReadableView(gateway)
  if (opening.status !== GameStatus.Live) {
    throw new Error(`A duel opens on a live game; this one is ${opening.status}`)
  }

  const players = new Map<string, RosterPlayer>()
  let snapshot = liveSnapshot(opening)

  /**
   * Add a view's seated players to the roster. Accumulated rather than replaced:
   * the loop takes one roster handle for the whole half, so a player seated in
   * an earlier at-bat must still resolve by name after the seats move on.
   */
  function remember(view: LiveGameView): void {
    players.set(view.batter.id, toRosterPlayer(view.batter))
    players.set(view.pitcher.id, toRosterPlayer(view.pitcher))
  }
  remember(opening)

  /** Read the server and install what came back. */
  async function install(): Promise<void> {
    const view = await requireReadableView(gateway)
    if (view.status === GameStatus.Final) {
      snapshot = finalSnapshot(snapshot, view.score, view.hits)
      return
    }
    remember(view)
    snapshot = liveSnapshot(view)
  }

  return {
    state: () => ({ ...snapshot.state, bases: { ...snapshot.state.bases } }),
    hits: () => byBattingSide(snapshot.state.half, snapshot.hits),
    roster: () => players,
    matchup: () =>
      buildMatchup(
        seated(players, snapshot.state.currentPitcher, SeatedRole.Pitcher).player,
        seated(players, snapshot.state.currentBatter, SeatedRole.Batter).player,
        snapshot.dueUp,
      ),
    refresh: install,

    async playAtBat(pitch: number, swing: number): Promise<DuelResolution> {
      const before = snapshot
      const { batter, opponent } = requireAtBat(before, players)
      const resolution = await commitBothSeats(gateway, { pitch, swing })

      // Both reads go out together, and this does not settle until they land:
      // the loop reads `state()` twice on the next line and must not see the
      // pre-commit snapshot. `revealedDuel` then checks that what came back is
      // this at-bat rather than trusting that it is.
      const [, duel] = await Promise.all([install(), gateway.readDuel()])
      const revealed = revealedDuel(duel, resolution.sequence)

      return {
        applied: {
          sequence: resolution.sequence,
          outsBefore: before.state.outs,
          outsAfter: revealed.outsAfter,
          basesAfter: revealed.basesAfter,
          runsScored: revealed.runsScored,
        },
        reveal: buildReveal({
          pitch: revealed.pitch,
          swing: revealed.swing,
          state: before.state,
          resolved: revealed,
          batter,
          opponent,
          hitsBefore: byBattingSide(before.state.half, before.hits),
        }),
      }
    },
  }
}

/**
 * A game this caller can read, live or finished, or refuse. `null` means a game
 * that is not there OR one the caller is not in — the read model does not
 * distinguish them, deliberately (ADR-0025), and neither is something to carry
 * on past with an empty snapshot. `scheduled` has no seats to commit for.
 */
async function requireReadableView(
  gateway: DuelGateway,
): Promise<LiveGameView | Extract<GameView, { status: GameStatus.Final }>> {
  const view = await gateway.readGame()
  if (!view) throw new Error('No readable game — it does not exist, or you are not in it')
  if (view.status === GameStatus.Scheduled) {
    throw new Error('A duel needs a game that has been started')
  }
  return view
}
