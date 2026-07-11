import {
  type BaseSpeeds,
  type BaseState,
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
import type { DuelSituation, RevealScenario } from './scenario'
import { isHit } from './scenario'

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
 * PERSPECTIVE — read before touching the reveal. The `RevealScenario` is a
 * view-model: its `you` / `them` / `opponent` / `scoreBefore` are all relative to
 * "the side this reveal is rendered FOR". In SAN-45's scope that side is fixed to
 * the **batter** (a single half-inning reveal — the at-bat is the batter's
 * moment), so `you` = the batting team throughout this module. This is NOT a
 * permanent law: when two-sided async multiplayer lands, the logged-in user owns a
 * team across BOTH halves and "you" becomes *their* side — which is the pitching
 * team during the opponent's at-bat. The generalization is local to this adapter:
 * add a `viewer` input and key the three perspective-bearing spots (`you`/`them`,
 * `scoreBefore`, `opponent`) off it instead of off the batting side. The engine
 * stays perspective-free and the `RevealScenario` shape does not change. Do not
 * let downstream UI assume `you === batter` on its own — decide it only here.
 */

/** Running hit totals from the reveal's perspective: `you` = the side the reveal
 * is rendered for (the batter, in SAN-45 — see the module header), `opp` = the
 * other side. */
export interface HitTotals {
  you: number
  opp: number
}

/** A fresh zeroed hit-total. A factory, NOT a shared singleton: each adapter and
 * each defaulted call gets its own object, so a caller can never mutate one
 * snapshot and corrupt another instance (cf. the engine freezing `EMPTY_BASES`). */
const noHits = (): HitTotals => ({ you: 0, opp: 0 })

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
 * One on-base runner's speed: a hitter contributes their stored base-running
 * speed; a pitcher-as-runner is forced to the slowest (1, SAN-16); an empty base
 * is null. An unknown id (occupied but absent from the roster) also defaults to 1.
 */
function runnerSpeed(id: RunnerId | null, roster: Roster): number | null {
  if (!id) return null
  const player = roster.get(id)
  return player && isHitterBlock(player.attributes) ? player.speed : 1
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
 * per the project's finite-value-set convention (cf. `Half`, `SwingType`). */
enum SeatedRole {
  Batter = 'batter',
  Pitcher = 'pitcher',
}

function seated(
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
}): string {
  const landing = batterLanding(params.basesAfter, params.batter)
  const clauses = [runsClause(params.runsScored), batterClause(params.outcome, landing)]
  return clauses.filter((c): c is string => c !== null).join(' · ')
}

// ── Hit accumulation ────────────────────────────────────────────────────────

/** Fold one outcome into the running hit totals: a hit credits the batting team
 * ("you"); anything else leaves the totals untouched. */
export function accumulateHits(hits: HitTotals, outcome: OutcomeKey): HitTotals {
  return isHit(outcome) ? { you: hits.you + 1, opp: hits.opp } : hits
}

// ── Resolve → apply → reveal ────────────────────────────────────────────────

/** The reveal's half label, total over the two-valued `Half` enum. */
function halfLabel(half: Half): 'TOP' | 'BOTTOM' {
  return half === Half.Top ? 'TOP' : 'BOTTOM'
}

/**
 * Score-before from the reveal's perspective. In SAN-45's scope the reveal is
 * rendered for the batter, so "you" = the batting team: the away team bats the top
 * half and the home team the bottom (SAN-21), and the mapping follows `state.half`
 * — a bottom-half reveal credits the home score, not the away score. This is one
 * of the three perspective-bearing spots the module header calls out: when a
 * `viewer` input lands, key "you"/"opp" off the viewer's team here instead of off
 * the batting side.
 */
function scoreBefore(state: LiveGameState): { you: number; opp: number } {
  return state.half === Half.Top
    ? { you: state.awayScore, opp: state.homeScore }
    : { you: state.homeScore, opp: state.awayScore }
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

function buildReveal(params: {
  pitch: number
  swing: number
  state: LiveGameState
  resolved: ResolvedAtBat
  applied: AppliedAtBat
  batter: RunnerId
  opponent: string
  hitsBefore: HitTotals
}): RevealScenario {
  const { pitch, swing, state, resolved, applied, batter, opponent, hitsBefore } = params
  const outcome = toOutcomeKey(resolved.outcome)
  return {
    // `you`/`them` are perspective-bearing: the batter's own swing vs. the pitch
    // they faced (SAN-45 renders for the batter). A `viewer` input would flip these
    // for the pitching side — see the module header.
    you: swing,
    them: pitch,
    opponent,
    outcome,
    inning: state.inning,
    half: halfLabel(state.half),
    outs: applied.outsAfter,
    runsScored: resolved.runsScored,
    scoreBefore: scoreBefore(state),
    hitsBefore,
    scoreline: deriveScoreline({
      outcome,
      basesAfter: resolved.basesAfter,
      runsScored: resolved.runsScored,
      batter,
    }),
  }
}

/**
 * Resolve one at-bat through the authoritative engine and split the result into
 * the `AppliedAtBat` (for `advance`) and the `RevealScenario` (for the reveal).
 * Pure: it reads the seated batter/pitcher from the live state, looks their
 * attributes up in the roster, assembles runner speeds, and resolves — the same
 * boundary the Convex vault runs server-side. `hitsBefore` is the running hit
 * total as of before this at-bat (surfaced as `RevealScenario.hitsBefore`).
 *
 * The reveal is built FOR THE BATTER (SAN-45 perspective scope — see the module
 * header): `opponent` is the pitcher faced, the third perspective-bearing spot a
 * future `viewer` input would generalize.
 */
export function resolveDuelAtBat(
  pitch: number,
  swing: number,
  state: LiveGameState,
  roster: Roster,
  hitsBefore: HitTotals = noHits(),
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
    applied,
    batter: batter.id,
    opponent: pitcher.player.name,
    hitsBefore,
  })
  return { applied, reveal }
}

// ── Stateful adapter ─────────────────────────────────────────────────────────

/** A pure (no I/O) adapter that threads the live state through `advance` and
 * tracks the running hit count from the batting side's perspective. */
export interface DuelAdapter {
  state(): LiveGameState
  hits(): HitTotals
  playAtBat(pitch: number, swing: number): DuelResolution
}

/**
 * Roll the running hit totals forward for the next at-bat: credit the side that
 * just batted, then — if the third out flipped the half — swap `you`↔`opp` so the
 * incoming batting side's own total is "you". The two teams alternate, so a side's
 * total is never lost, it just moves between the two slots. This keeps `hitsBefore`
 * consistent with the half-based `scoreBefore` (see `buildReveal`); within a single
 * half-inning (SAN-45's scope) the half never changes and this is a plain credit.
 */
function rollHitTotals(hits: HitTotals, outcome: OutcomeKey, before: Half, after: Half): HitTotals {
  const credited = accumulateHits(hits, outcome)
  return before === after ? credited : { you: credited.opp, opp: credited.you }
}

/**
 * Create a duel adapter seeded from the lineups. Each `playAtBat` resolves the
 * current matchup, folds the result into the live state via the engine's
 * `advance`, and rolls the hit count forward — so successive at-bats carry the
 * correct `hitsBefore` and base state, and the totals follow the batting side if
 * a third out flips the half.
 */
export function createDuelAdapter(roster: Roster, context: GameContext): DuelAdapter {
  let liveState = startGame(context)
  let hitTotals: HitTotals = noHits()
  return {
    // Hand back defensive copies — a caller must not be able to mutate a snapshot
    // and corrupt a future at-bat. `bases` is the one nested mutable that feeds
    // back into resolution, so copy it too.
    state: () => ({ ...liveState, bases: { ...liveState.bases } }),
    hits: () => ({ ...hitTotals }),
    playAtBat(pitch, swing) {
      const resolution = resolveDuelAtBat(pitch, swing, liveState, roster, hitTotals)
      const nextState = advance(liveState, resolution.applied, context)
      hitTotals = rollHitTotals(
        hitTotals,
        resolution.reveal.outcome,
        liveState.half,
        nextState.half,
      )
      liveState = nextState
      return resolution
    },
  }
}

// ── Non-secret situation + matchup derivation (commit-screen inputs) ─────────

/**
 * Project the non-secret situation for the seat about to commit — the whole input
 * a commit screen (and a seat agent) is allowed to see. The return type
 * `DuelSituation` structurally excludes both duel numbers, and `opponent` is the
 * pitcher faced (matching the reveal's perspective). `scoreBefore` is the third
 * perspective-bearing spot the module header calls out — it already keys "you" off
 * the batting side via {@link scoreBefore}.
 */
export function deriveSituation(
  state: LiveGameState,
  hits: HitTotals,
  roster: Roster,
): DuelSituation {
  const pitcher = seated(roster, state.currentPitcher, SeatedRole.Pitcher)
  return {
    opponent: pitcher.player.name,
    inning: state.inning,
    half: halfLabel(state.half),
    outs: state.outs,
    scoreBefore: scoreBefore(state),
    hitsBefore: { you: hits.you, opp: hits.opp },
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
 * Build the commit screen's two-sided matchup from live state. Hotseat casts the
 * currently-batting side as "you", so both seats depict the SAME real pitcher-vs-
 * batter matchup — `DuelCommit.orientSeat` flips which side throws vs. swings per
 * seat. Attribute blocks are mapped from the engine domain to the UI's pip labels
 * here (the components never see the engine shapes).
 */
export function deriveMatchup(
  state: LiveGameState,
  roster: Roster,
  context: GameContext,
): DuelMatchup {
  const pitcher = seated(roster, state.currentPitcher, SeatedRole.Pitcher)
  const batter = seated(roster, state.currentBatter, SeatedRole.Batter)
  const side = {
    pitcher: {
      name: pitcher.player.name,
      attrs: displayPitcher(pitcherAttributes(pitcher.player)),
    },
    batter: { name: batter.player.name, attrs: displayHitter(hitterAttributes(batter.player)) },
    dueUp: dueUp(state, context, roster),
  }
  return { you: side, opponent: side }
}
