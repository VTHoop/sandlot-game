import {
  type BaseSpeeds,
  type BaseState,
  baseRunningSpeed,
  GroundBallResult,
  type HitterAttributes,
  type PitcherAttributes,
  type ResolvedAtBat,
  type RunnerId,
  resolveAtBat,
} from '@sandlot/engine/atBat'
import {
  type AppliedAtBat,
  advance,
  type GameContext,
  Half,
  type LiveGameState,
  startGame,
  type TeamLineup,
} from '@sandlot/engine/game'
import type { OutcomeBandKey } from '@sandlot/engine/outcomes'
import type { OutcomeKey } from '../../components/ui/OutcomeLadder'
import type { DuelMatchup, MatchupSide } from './MatchupCard'
import type { Roster, RosterPlayer } from './roster'
import {
  type ClubPair,
  clubLabel,
  type DuelSituation,
  FieldSpot,
  isHit,
  outcomeName,
  type RevealScenario,
  type RunnerMovement,
} from './scenario'

/**
 * The pure, headless duel adapter (SAN-45): the boundary that bridges the
 * roster-free engine to the UI's data shapes. No React, no I/O — the same
 * resolve → apply → reveal logic the future Convex client reuses.
 *
 * AUTHORITY — this is NOT the vault. The authoritative at-bat resolution and the
 * game-state writes are the Convex mutation's job (`convex/atBat.ts`, ADR-0016):
 * the server reads both secret numbers, resolves, appends the `atBats` log, and
 * updates the live row in ONE transaction — clients never arbitrate or write
 * authoritative state (AGENTS.md game integrity). This module is the *read-only*
 * reuse of that same shared engine call (ADR-0009): it operates on a
 * `LiveGameState` it is handed and writes nothing authoritative — `createDuelAdapter`
 * threads an in-memory state for fixtures/previews only. Do not route real game
 * progression through here; call the mutation and reuse this for the reveal.
 *
 * NO PERSPECTIVE — the view-models this module builds are absolute (SAN-39,
 * ADR-0030). A `RevealScenario` names the pitch and the swing, the pitcher and the
 * batter, and carries every total as away/home; nothing in it is "you" or "them".
 * It used to be rendered FOR the batter, which held for a single hotseat
 * half-inning and for nothing after it: a club that is pitching is not the
 * batter, and an owner of both clubs is nobody's opponent. Describing the at-bat
 * by what happened means there is no viewer to thread through here at all — the
 * server already answers absolutely (ADR-0025), and this module no longer
 * translates that away. Do not reintroduce a viewer-relative field; a screen
 * that wants to mark "yours" does it from `getGame`'s `viewerOwns`, on top of
 * these shapes.
 */

/**
 * The live state a duel consumer reads — a subset of the engine's
 * `LiveGameState`. The batting-order pointers and the applied-sequence marker
 * are the authoritative writer's own bookkeeping, and the server read model
 * deliberately returns neither (ADR-0025: renderable data, not raw pointers).
 * Naming them here would force the Convex-backed adapter to invent two numbers
 * no consumer reads, so the contract is narrowed to what the duel screens and
 * the play loop genuinely consume instead.
 *
 * `LiveGameState` is assignable to this, so the in-memory adapter satisfies it
 * by construction and still hands its own callers the full envelope.
 */
export type DuelState = Pick<
  LiveGameState,
  | 'status'
  | 'inning'
  | 'half'
  | 'outs'
  | 'bases'
  | 'homeScore'
  | 'awayScore'
  | 'currentBatter'
  | 'currentPitcher'
>

/** Each club's running hit total, absolute. */
export type HitTotals = ClubPair<number>

/** A fresh zeroed hit-total. A factory, NOT a shared singleton: each adapter and
 * each defaulted call gets its own object, so a caller can never mutate one
 * snapshot and corrupt another instance (cf. the engine freezing `EMPTY_BASES`). */
const noHits = (): HitTotals => ({ away: 0, home: 0 })

/**
 * What the scoreboard knows that the live state does not: each club's label and
 * its hits so far. The engine tracks neither (hits are a log rollup, ADR-0004;
 * a club's name is not the engine's business, ADR-0009), so whoever holds the
 * state hands these in beside it.
 */
export interface Board {
  clubs: ClubPair<string>
  hits: HitTotals
}

/** One resolved at-bat split into its two consumers: the `AppliedAtBat` the
 * engine's `advance` folds in, and the `RevealScenario` the reveal renders. */
export interface DuelResolution {
  applied: AppliedAtBat
  reveal: RevealScenario
}

// ── Roster lookups ──────────────────────────────────────────────────────────

function isHitterBlock(attrs: HitterAttributes | PitcherAttributes): attrs is HitterAttributes {
  return 'power' in attrs
}

/**
 * An id the roster does not know: corrupt input to a fixture path, run at the
 * slowest rating rather than crashing a preview. Its own rule, deliberately
 * separate from the pitcher-as-runner one the engine owns — they agree on a
 * value today and are not the same decision.
 */
const UNKNOWN_RUNNER_SPEED = 1

/**
 * One on-base runner's speed: read from their attribute block through the
 * engine's rule (a pitcher-as-runner is the slowest, SAN-16); an empty base is
 * null; an unknown id falls back to {@link UNKNOWN_RUNNER_SPEED}.
 */
function runnerSpeed(id: RunnerId | null, roster: Roster): number | null {
  if (!id) return null
  const player = roster.get(id)
  return player ? baseRunningSpeed(player.attributes) : UNKNOWN_RUNNER_SPEED
}

/**
 * Assemble the engine's `BaseSpeeds` from a live state's bases plus the roster,
 * defaulting a pitcher-as-runner to speed 1. Pure: the engine never holds a
 * roster handle (ADR-0009) — the caller resolves ids → speed here.
 */
export function assembleRunnerSpeeds(bases: BaseState, roster: Roster): BaseSpeeds {
  return {
    first: runnerSpeed(bases.first, roster),
    second: runnerSpeed(bases.second, roster),
    third: runnerSpeed(bases.third, roster),
  }
}

/** Which seat `seated` is resolving — labels the "nobody seated" error. A TS enum
 * per the project's finite-value-set convention (cf. `Half`, `SwingType`).
 * Exported so the Convex-backed adapter resolves its seats through the same
 * lookup rather than a copy that types the role as a bare string. */
export enum SeatedRole {
  Batter = 'batter',
  Pitcher = 'pitcher',
}

export function seated(
  roster: Roster,
  id: string | null,
  role: SeatedRole,
): { id: string; player: RosterPlayer } {
  const player = id ? roster.get(id) : undefined
  if (!id || !player) throw new Error(`No ${role} is seated in the current live state`)
  return { id, player }
}

function hitterAttributes(player: RosterPlayer): HitterAttributes {
  if (isHitterBlock(player.attributes)) return player.attributes
  throw new Error(`Batter ${player.name} does not carry a hitter attribute block`)
}

function pitcherAttributes(player: RosterPlayer): PitcherAttributes {
  if (!isHitterBlock(player.attributes)) return player.attributes
  throw new Error(`Pitcher ${player.name} does not carry a pitcher attribute block`)
}

// ── Outcome mapping (engine band → UI key) ──────────────────────────────────

/**
 * Engine `OutcomeBandKey` → UI `OutcomeKey`. Today the two enums are identical
 * (the ladder is sourced from the engine), so this is an explicit identity map —
 * but listing it exhaustively means a future UI rename fails loudly here and in
 * the mirror test rather than silently mis-displaying. `satisfies` forces all ten
 * band keys at compile time while keeping the literal entry types; the `Map` keeps
 * lookups injection-safe.
 */
export const OUTCOME_KEY_BY_BAND = {
  HR: 'HR',
  '3B': '3B',
  '2B': '2B',
  '1B': '1B',
  IF1B: 'IF1B',
  BB: 'BB',
  FO: 'FO',
  PO: 'PO',
  GB: 'GB',
  K: 'K',
} satisfies Record<OutcomeBandKey, OutcomeKey>

// `satisfies` keeps the literal value types, so `Object.entries` already yields
// `[string, OutcomeKey]` — no tuple cast needed to build the lookup.
const OUTCOME_KEY_LOOKUP: ReadonlyMap<string, OutcomeKey> = new Map(
  Object.entries(OUTCOME_KEY_BY_BAND),
)

/** Map an engine outcome band to its UI key, throwing on an unmapped band so a
 * drift never reaches the reveal silently. */
export function toOutcomeKey(band: OutcomeBandKey): OutcomeKey {
  const key = OUTCOME_KEY_LOOKUP.get(band)
  if (!key) throw new RangeError(`unmapped outcome band: ${band}`)
  return key
}

// ── Scoreline derivation ────────────────────────────────────────────────────

const OUT_PHRASE: ReadonlyMap<OutcomeKey, string> = new Map([
  ['FO', 'you fly out'],
  ['PO', 'you pop out'],
  ['GB', 'you ground out'],
  ['K', 'you strike out'],
])

/** Where the batter ended up, read from the post-state bases (null = scored or out). */
function batterLanding(basesAfter: BaseState, batter: RunnerId): string | null {
  if (basesAfter.first === batter) return '1st'
  if (basesAfter.second === batter) return '2nd'
  if (basesAfter.third === batter) return '3rd'
  return null
}

function runsClause(runsScored: number): string | null {
  if (runsScored <= 0) return null
  return runsScored === 1 ? '1 run scores' : `${runsScored} runs score`
}

function batterClause(outcome: OutcomeKey, landing: string | null): string {
  if (landing) return outcome === 'BB' ? `you reach ${landing}` : `you stand on ${landing}`
  if (isHit(outcome)) return 'you go yard'
  return OUT_PHRASE.get(outcome) ?? 'you are out'
}

/**
 * Derive the reveal's scoreline from the resolved outcome and base movement (the
 * engine produces neither): the runs that crossed the plate plus where the batter
 * ended up, joined into one line — e.g. "1 run scores · you stand on 2nd".
 */
export function deriveScoreline(params: {
  outcome: OutcomeKey
  basesAfter: BaseState
  runsScored: number
  batter: RunnerId
  /** The batter's display name — the line names them in the third person. */
  batterName: string
}): string {
  const landing = batterLanding(params.basesAfter, params.batter)
  const clauses = [runsClause(params.runsScored), batterClause(params.outcome, landing)]
  return clauses.filter((c): c is string => c !== null).join(' · ')
}

// ── Headline (the reveal's shouted result) ───────────────────────────────────

/**
 * The distinct headlines a groundball can shout. A TS enum (per the project's
 * finite-value-set convention) single-sources the copy that several sub-results
 * share — a fielder's choice reads the same whether the force was at 2nd, 3rd, or
 * home — and makes {@link GB_RESULT_HEADLINE} value-type-safe (a typo'd string
 * can't sneak in). Display copy, so it lives here in the adapter, never in the
 * engine's `GroundBallResult` (ADR-0009: the engine stays UI-free).
 */
export enum GbHeadline {
  Groundout = 'GROUNDOUT',
  FieldersChoice = "FIELDER'S CHOICE",
  DoublePlay = 'DOUBLE PLAY',
  TriplePlay = 'TRIPLE PLAY',
}

/**
 * Groundball sub-result → the headline it reads as. The `GB` band collapses eight
 * distinct plays; without this they'd all shout "GROUNDOUT" and a double play would
 * look like a routine out (the runners just vanish). One row per `GroundBallResult`
 * (not a shared-headline shortcut) so a future divergence — e.g. `FC_HOME` reading
 * "OUT AT HOME" — is a one-line change. A Map keeps the lookup off the
 * object-injection sink; an unmapped result throws in `deriveHeadline` (the mirror
 * test pins every `GroundBallResult`), so a new sub-result fails loudly, not silently.
 */
const GB_RESULT_HEADLINE = new Map<GroundBallResult, GbHeadline>([
  [GroundBallResult.GO, GbHeadline.Groundout],
  [GroundBallResult.GO_RA, GbHeadline.Groundout],
  [GroundBallResult.FC, GbHeadline.FieldersChoice],
  [GroundBallResult.FC_2ND, GbHeadline.FieldersChoice],
  [GroundBallResult.FC_3RD, GbHeadline.FieldersChoice],
  [GroundBallResult.FC_HOME, GbHeadline.FieldersChoice],
  [GroundBallResult.DP, GbHeadline.DoublePlay],
  [GroundBallResult.TP, GbHeadline.TriplePlay],
])

/**
 * Name the reveal's headline. Most outcomes read as their band's name; a groundball
 * carries a finer `groundBallResult` (fielder's choice / double play / …) that names
 * itself, so "GROUNDOUT" no longer stands in for a twin killing. Throws on an
 * unmapped sub-result so a new `GroundBallResult` fails loudly here rather than
 * silently mislabeling.
 */
export function deriveHeadline(
  outcome: OutcomeKey,
  groundBallResult: GroundBallResult | null,
): string {
  if (groundBallResult !== null) {
    const headline = GB_RESULT_HEADLINE.get(groundBallResult)
    if (!headline) throw new RangeError(`unmapped ground-ball result: ${groundBallResult}`)
    return headline
  }
  return outcomeName(outcome)
}

// ── Runner movement (field animation) ────────────────────────────────────────

/** Which base a runner id occupies after the play, or null if they left the bases
 * (scored or retired). Explicit property reads — no variable-key indexing on the
 * injection sink (cf. the roster's Map convention). */
function landingSpot(basesAfter: BaseState, id: RunnerId): FieldSpot | null {
  if (basesAfter.third === id) return FieldSpot.Third
  if (basesAfter.second === id) return FieldSpot.Second
  if (basesAfter.first === id) return FieldSpot.First
  return null
}

/**
 * The base a runner is forced to — one ahead of where they started, in running
 * order. A ground ball is a force play, so a retired runner is out AT this base
 * (batter→1st, 1st→2nd, 2nd→3rd, 3rd→home); that single rule reproduces the whole
 * `GroundBallResult` out-location table (GO→1st, FC*→the forced bag, DP/TP→each
 * forced runner at its bag). A Map keeps the lookup off the object-injection sink.
 */
const FORCE_OUT_BASE: ReadonlyMap<FieldSpot, FieldSpot> = new Map([
  [FieldSpot.Batter, FieldSpot.First],
  [FieldSpot.First, FieldSpot.Second],
  [FieldSpot.Second, FieldSpot.Third],
  [FieldSpot.Third, FieldSpot.Home],
])

/**
 * Where a retired runner's out is shown. A ground ball is a FORCE play (SAN-16 only
 * resolves force outs), so the runner is out at the base they were forced to — the
 * `from + 1` bag {@link FORCE_OUT_BASE} gives, derived from the play being a GB at
 * all. An air out or strikeout carries no `groundBallResult` and has no force base,
 * so the runner is retired in place (`to === from`) and fades where it stands (the
 * batter at the plate, a hypothetical doubled-off runner at its base). Throws if a
 * force play somehow retires a runner already at home — a real out can't.
 */
function retirementSpot(from: FieldSpot, groundBallResult: GroundBallResult | null): FieldSpot {
  if (groundBallResult === null) return from
  const forced = FORCE_OUT_BASE.get(from)
  if (!forced) throw new RangeError(`no force-out base for ${from}`)
  return forced
}

/**
 * Trace every runner's real journey for the reveal's field animation. The engine
 * preserves runner identity across bases (`RunnerId`), so each on-base runner and
 * the batter is followed from where they started to where they ended: still on a
 * base (advanced or held), across the plate (scored), or off the board (retired).
 *
 * A runner absent from `basesAfter` either scored or was put out — before/after
 * alone can't say which. Runs are credited to the LEAD runners (closest to home),
 * so we process in lead order (third → second → first → batter) and let the
 * frontmost `runsScored` departed runners score; every remaining departure is an
 * out. This is the same lead-runner-scores convention the box score implies, and it
 * covers the real cases (sac fly: the runner on third scores, the batter is out;
 * force DP: the trail runner and batter are both out with no run).
 *
 * A departed runner who was put out is located from the play: `groundBallResult`
 * marks a force play, so the out is recorded at the base the runner was forced to
 * ({@link retirementSpot}); an air out / strikeout has no force base and is retired
 * in place. This is why before/after state alone is not enough — it can say a runner
 * left the bases but not WHERE the out happened.
 */
export function deriveRunnerMovements(params: {
  basesBefore: BaseState
  basesAfter: BaseState
  batter: RunnerId
  runsScored: number
  groundBallResult: GroundBallResult | null
}): RunnerMovement[] {
  const { basesBefore, basesAfter, batter, runsScored, groundBallResult } = params
  const starters: Array<{ id: RunnerId; from: FieldSpot }> = []
  const addStarter = (id: RunnerId | null, from: FieldSpot) => {
    if (id) starters.push({ id, from })
  }
  // Lead order (closest to home first) so score credit falls to the front runners.
  addStarter(basesBefore.third, FieldSpot.Third)
  addStarter(basesBefore.second, FieldSpot.Second)
  addStarter(basesBefore.first, FieldSpot.First)
  starters.push({ id: batter, from: FieldSpot.Batter })

  let scored = 0
  return starters.map(({ id, from }) => {
    const landing = landingSpot(basesAfter, id)
    if (landing) return { from, to: landing, retired: false }
    if (scored < runsScored) {
      scored += 1
      return { from, to: FieldSpot.Home, retired: false }
    }
    return { from, to: retirementSpot(from, groundBallResult), retired: true }
  })
}

// ── Hit accumulation ────────────────────────────────────────────────────────

/** Fold one outcome into the running hit totals: a hit credits the club that was
 * batting — away in the top half, home in the bottom (SAN-21); anything else
 * leaves the totals untouched. */
export function accumulateHits(hits: HitTotals, outcome: OutcomeKey, half: Half): HitTotals {
  if (!isHit(outcome)) return hits
  return half === Half.Top
    ? { away: hits.away + 1, home: hits.home }
    : { away: hits.away, home: hits.home + 1 }
}

// ── Resolve → apply → reveal ────────────────────────────────────────────────

/** The reveal's half label, total over the two-valued `Half` enum. */
function halfLabel(half: Half): 'TOP' | 'BOTTOM' {
  return half === Half.Top ? 'TOP' : 'BOTTOM'
}

/** The score as the live state holds it: one total per club, no flip. */
function scoreBefore(state: DuelState): ClubPair<number> {
  return { away: state.awayScore, home: state.homeScore }
}

function buildApplied(state: LiveGameState, resolved: ResolvedAtBat): AppliedAtBat {
  return {
    sequence: state.lastResolvedSequence + 1,
    outsBefore: state.outs,
    outsAfter: resolved.outsAfter,
    basesAfter: resolved.basesAfter,
    runsScored: resolved.runsScored,
  }
}

/**
 * The resolved facts a reveal is built from, named apart from whoever produced
 * them. The engine's `ResolvedAtBat` satisfies it structurally, and so does the
 * server's resolved duel view — which is what lets the Convex-backed adapter
 * render the reveal from the SERVER's outcome (ADR-0016: clients never arbitrate)
 * through the very same builder the fixture path uses.
 */
export interface ResolvedFacts {
  outcome: OutcomeBandKey
  groundBallResult: GroundBallResult | null
  runsScored: number
  outsAfter: number
  basesAfter: BaseState
}

/**
 * The two players an at-bat is between, by id and display name. The batter's id
 * travels because the base state is keyed by it; the pitcher is only ever named.
 */
export interface AtBatPlayers {
  batter: { id: RunnerId; name: string }
  pitcher: string
}

/**
 * Build the reveal a resolved at-bat renders as. Absolute throughout (see the
 * module header) and derived entirely from the before-state plus the resolved
 * facts, so it holds whether those facts came from the local engine call or from
 * the server's authoritative one.
 */
export function buildReveal(params: {
  pitch: number
  swing: number
  state: DuelState
  resolved: ResolvedFacts
  players: AtBatPlayers
  board: Board
}): RevealScenario {
  const { pitch, swing, state, resolved, players, board } = params
  const outcome = toOutcomeKey(resolved.outcome)
  return {
    movements: deriveRunnerMovements({
      basesBefore: state.bases,
      basesAfter: resolved.basesAfter,
      batter: players.batter.id,
      runsScored: resolved.runsScored,
      groundBallResult: resolved.groundBallResult,
    }),
    pitch,
    swing,
    pitcher: players.pitcher,
    batter: players.batter.name,
    clubs: board.clubs,
    outcome,
    inning: state.inning,
    half: halfLabel(state.half),
    outs: resolved.outsAfter,
    runsScored: resolved.runsScored,
    scoreBefore: scoreBefore(state),
    hitsBefore: board.hits,
    headline: deriveHeadline(outcome, resolved.groundBallResult),
    scoreline: deriveScoreline({
      outcome,
      basesAfter: resolved.basesAfter,
      runsScored: resolved.runsScored,
      batter: players.batter.id,
      batterName: players.batter.name,
    }),
  }
}

/**
 * Resolve one at-bat through the authoritative engine and split the result into
 * the `AppliedAtBat` (for `advance`) and the `RevealScenario` (for the reveal).
 * Pure: it reads the seated batter/pitcher from the live state, looks their
 * attributes up in the roster, assembles runner speeds, and resolves — the same
 * boundary the Convex vault runs server-side. `board` is the scoreboard as of
 * before this at-bat (its hits surface as `RevealScenario.hitsBefore`).
 */
export function resolveDuelAtBat(
  pitch: number,
  swing: number,
  state: LiveGameState,
  roster: Roster,
  board: Board,
): DuelResolution {
  const batter = seated(roster, state.currentBatter, SeatedRole.Batter)
  const pitcher = seated(roster, state.currentPitcher, SeatedRole.Pitcher)
  const resolved = resolveAtBat({
    pitch,
    swing,
    hitter: hitterAttributes(batter.player),
    pitcher: pitcherAttributes(pitcher.player),
    basesBefore: state.bases,
    outsBefore: state.outs,
    batter: batter.id,
    runnerSpeeds: assembleRunnerSpeeds(state.bases, roster),
  })
  const applied = buildApplied(state, resolved)
  const reveal = buildReveal({
    pitch,
    swing,
    state,
    resolved,
    players: {
      batter: { id: batter.id, name: batter.player.name },
      pitcher: pitcher.player.name,
    },
    board,
  })
  return { applied, reveal }
}

// ── Stateful adapter ─────────────────────────────────────────────────────────

/**
 * What `playHalfInning` drives, and all it may assume. Two implementations
 * satisfy it — the in-memory one below and the Convex-backed one (SAN-57) — and
 * the loop never branches on which it holds.
 *
 * `state()` and `hits()` are synchronous, answered from whatever snapshot the
 * implementation already has. `playAtBat` may be either synchronous (the fixture
 * path resolves in-process) or a promise (the Convex path is a round trip), so
 * the loop awaits it; a resolved value awaits to itself.
 */
export interface DuelAdapter {
  state(): DuelState
  /** Each club's hits so far, absolute. */
  hits(): HitTotals
  /** Each club's scoreboard label. */
  clubs(): ClubPair<string>
  playAtBat(pitch: number, swing: number): DuelResolution | Promise<DuelResolution>
}

/**
 * The fixture adapter's own contract: it holds the whole engine envelope and
 * resolves in-process, so its callers keep both — a narrowing here would hide
 * state the in-memory path genuinely has.
 */
export interface InMemoryDuelAdapter extends DuelAdapter {
  state(): LiveGameState
  playAtBat(pitch: number, swing: number): DuelResolution
}

/**
 * Create a duel adapter seeded from the lineups and the two clubs' names. Each
 * `playAtBat` resolves the current matchup, folds the result into the live state
 * via the engine's `advance`, and credits a hit to the club that was batting —
 * so successive at-bats carry the correct `hitsBefore` and base state. The
 * totals are absolute, so a third out that flips the half moves nothing.
 */
export function createDuelAdapter(
  roster: Roster,
  context: GameContext,
  clubNames: ClubPair<string>,
): InMemoryDuelAdapter {
  const clubs: ClubPair<string> = {
    away: clubLabel(clubNames.away),
    home: clubLabel(clubNames.home),
  }
  let liveState = startGame(context)
  let hitTotals: HitTotals = noHits()
  return {
    // Hand back defensive copies — a caller must not be able to mutate a snapshot
    // and corrupt a future at-bat. `bases` is the one nested mutable that feeds
    // back into resolution, so copy it too.
    state: () => ({ ...liveState, bases: { ...liveState.bases } }),
    hits: () => ({ ...hitTotals }),
    clubs: () => ({ ...clubs }),
    playAtBat(pitch, swing) {
      const board = { clubs: { ...clubs }, hits: { ...hitTotals } }
      const resolution = resolveDuelAtBat(pitch, swing, liveState, roster, board)
      hitTotals = accumulateHits(hitTotals, resolution.reveal.outcome, liveState.half)
      liveState = advance(liveState, resolution.applied, context)
      return resolution
    },
  }
}

// ── Non-secret situation + matchup derivation (commit-screen inputs) ─────────

/**
 * The occupied bases in lead order (third → first) — the commit field's live
 * occupancy (SAN-51). Occupancy only, never runner identity: explicit property
 * reads, no computed keys (cf. `landingSpot`).
 */
function occupiedBases(bases: BaseState): FieldSpot[] {
  const spots: FieldSpot[] = []
  if (bases.third) spots.push(FieldSpot.Third)
  if (bases.second) spots.push(FieldSpot.Second)
  if (bases.first) spots.push(FieldSpot.First)
  return spots
}

/**
 * Project the non-secret situation — the whole input a commit screen (and a seat
 * agent) is allowed to see. The return type `DuelSituation` structurally excludes
 * both duel numbers. It is the same for either seat: both players are named and
 * every total is away/home (see the module header).
 */
export function deriveSituation(state: DuelState, board: Board, roster: Roster): DuelSituation {
  return {
    pitcher: seated(roster, state.currentPitcher, SeatedRole.Pitcher).player.name,
    batter: seated(roster, state.currentBatter, SeatedRole.Batter).player.name,
    clubs: board.clubs,
    inning: state.inning,
    half: halfLabel(state.half),
    outs: state.outs,
    scoreBefore: scoreBefore(state),
    hitsBefore: { ...board.hits },
    runnersOn: occupiedBases(state.bases),
  }
}

/** Engine hitter attributes → the UI's pip labels. */
function displayHitter(attrs: HitterAttributes): MatchupSide['attrs'] {
  return { PWR: attrs.power, CON: attrs.contact, SPD: attrs.speed, EYE: attrs.eye }
}

/** Engine pitcher attributes → the UI's pip labels (awareness is not shown). */
function displayPitcher(attrs: PitcherAttributes): MatchupSide['attrs'] {
  return { VEL: attrs.velocity, MOV: attrs.movement, CMD: attrs.command }
}

/** The batting side's order and pointer for the current half (top = away). */
function battingLineup(
  state: LiveGameState,
  context: GameContext,
): { order: TeamLineup['battingOrder']; index: number } {
  return state.half === Half.Top
    ? { order: context.away.battingOrder, index: state.awayBattingIndex }
    : { order: context.home.battingOrder, index: state.homeBattingIndex }
}

/** The next two hitters due up after the current batter, by display name. */
function dueUp(state: LiveGameState, context: GameContext, roster: Roster): string[] {
  const { order, index } = battingLineup(state, context)
  return [1, 2]
    .map((offset) => roster.get(order[(index + offset) % order.length])?.name)
    .filter((name) => name !== undefined)
}

/**
 * Assemble the matchup from players that are already resolved: the one real
 * pitcher-vs-batter pairing, which both seats look at. Attribute blocks are
 * mapped from the engine domain to the UI's pip labels here (the components never
 * see the engine shapes).
 *
 * `dueUp` is passed in rather than derived, because the two paths learn it
 * differently: the fixture path walks its own lineups, and the Convex path is
 * handed the names by the read model (which owns the batting-order pointer).
 */
export function buildMatchup(
  pitcher: RosterPlayer,
  batter: RosterPlayer,
  dueUp: readonly string[],
): DuelMatchup {
  return {
    pitcher: { name: pitcher.name, attrs: displayPitcher(pitcherAttributes(pitcher)) },
    batter: { name: batter.name, attrs: displayHitter(hitterAttributes(batter)) },
    dueUp,
  }
}

/** Build the commit screen's matchup from fixture state and lineups. */
export function deriveMatchup(
  state: LiveGameState,
  roster: Roster,
  context: GameContext,
): DuelMatchup {
  const pitcher = seated(roster, state.currentPitcher, SeatedRole.Pitcher)
  const batter = seated(roster, state.currentBatter, SeatedRole.Batter)
  return buildMatchup(pitcher.player, batter.player, dueUp(state, context, roster))
}
