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
} from '@sandlot/engine/game'
import type { OutcomeBandKey } from '@sandlot/engine/outcomes'
import type { OutcomeKey } from '../../components/ui/OutcomeLadder'
import type { Roster, RosterPlayer } from './roster'
import type { RevealScenario } from './scenario'
import { isHit } from './scenario'

/**
 * The pure, headless duel adapter (SAN-45): the boundary that bridges the
 * roster-free engine to the UI's data shapes. No React, no I/O — the same
 * resolve → apply → reveal logic the future Convex client reuses.
 */

/** Running team hit totals (batting team = "you"; the fielding team = "opp"). */
export interface HitTotals {
  you: number
  opp: number
}

const NO_HITS: HitTotals = { you: 0, opp: 0 }

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

function seated(
  roster: Roster,
  id: string | null,
  role: 'batter' | 'pitcher',
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
 * the mirror test rather than silently mis-displaying. The `Record` type forces
 * all ten band keys at compile time; the `Map` keeps lookups injection-safe.
 */
export const OUTCOME_KEY_BY_BAND: Record<OutcomeBandKey, OutcomeKey> = {
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
}

const OUTCOME_KEY_LOOKUP: ReadonlyMap<OutcomeBandKey, OutcomeKey> = new Map(
  Object.entries(OUTCOME_KEY_BY_BAND) as [OutcomeBandKey, OutcomeKey][],
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
 * Score-before from the batting team's perspective ("you" = whoever is at bat).
 * The away team bats the top half and the home team the bottom (SAN-21), so the
 * mapping follows `state.half`. Perspective is *fixed* per half-inning — it never
 * flips mid-stream (SAN-45) — but "you" is the batting side either way, so a
 * bottom-half reveal credits the home score, not the away score.
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
 */
export function resolveDuelAtBat(
  pitch: number,
  swing: number,
  state: LiveGameState,
  roster: Roster,
  hitsBefore: HitTotals = NO_HITS,
): DuelResolution {
  const batter = seated(roster, state.currentBatter, 'batter')
  const pitcher = seated(roster, state.currentPitcher, 'pitcher')
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

// ── Stateful single-half-inning adapter ─────────────────────────────────────

/** A pure (no I/O) adapter that threads the live state through `advance` and
 * tracks the running hit count across a half-inning of at-bats. */
export interface DuelAdapter {
  state(): LiveGameState
  hits(): HitTotals
  playAtBat(pitch: number, swing: number): DuelResolution
}

/**
 * Create a duel adapter seeded from the lineups. Each `playAtBat` resolves the
 * current matchup, folds the result into the live state via the engine's
 * `advance`, and accumulates the hit count — so successive at-bats carry the
 * correct `hitsBefore` and base state.
 */
export function createDuelAdapter(roster: Roster, context: GameContext): DuelAdapter {
  let liveState = startGame(context)
  let hitTotals: HitTotals = NO_HITS
  return {
    state: () => liveState,
    hits: () => hitTotals,
    playAtBat(pitch, swing) {
      const resolution = resolveDuelAtBat(pitch, swing, liveState, roster, hitTotals)
      liveState = advance(liveState, resolution.applied, context)
      hitTotals = accumulateHits(hitTotals, resolution.reveal.outcome)
      return resolution
    },
  }
}
