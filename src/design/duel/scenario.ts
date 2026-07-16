import type { OutcomeKey } from '../../components/ui/OutcomeLadder'

/**
 * A node on the base-running path — where a runner starts or ends on the reveal's
 * field. An enum (not a literal union) per the project's finite-value-set
 * convention. `Batter` (stepping in at the plate) is a start-only spot; `Home`
 * (scored) and `Out` (retired on the play) are end-only. The three bases can be
 * either end of a journey.
 */
export enum FieldSpot {
  Batter = 'batter',
  First = 'first',
  Second = 'second',
  Third = 'third',
  Home = 'home',
  Out = 'out',
}

/**
 * One runner's journey across the play, so the reveal animates the REAL base
 * running rather than a canned flourish: the batter (and each on-base runner)
 * traced from where they started (`from`) to where they ended (`to`). A held
 * runner has `from === to`; a scorer ends at `Home`; a retired runner ends at
 * `Out`. Derived in the adapter from the engine's before/after base state, which
 * preserves runner identity (`RunnerId`) across bases.
 */
export interface RunnerMovement {
  from: FieldSpot
  to: FieldSpot
}

/** A resolved at-bat from the viewer's (batter's) perspective. */
export interface RevealScenario {
  you: number
  them: number
  opponent: string
  outcome: OutcomeKey
  inning: number
  half: 'TOP' | 'BOTTOM'
  outs: number
  /** Runs the batting team scored on this play. */
  runsScored: number
  scoreBefore: { you: number; opp: number }
  hitsBefore: { you: number; opp: number }
  scoreline: string
  /** The headline word(s) the reveal shouts — the specific result, not just the
   * band. A groundball resolves into a fielder's choice / double play / etc., each
   * of which reads differently; the adapter names it (see `deriveHeadline`) so
   * "GROUNDOUT" no longer stands in for a double play. */
  headline: string
  /** Each runner's real journey this play, for the field animation. Empty only
   * when nobody moved (never in practice — the batter is always traced). */
  movements: RunnerMovement[]
}

/**
 * The non-secret situation shown on the commit and waiting screens: a deliberate
 * subset of `RevealScenario` that EXCLUDES `you`/`them` (and the resolved
 * `outcome`/`scoreline`). The commit screen must be structurally incapable of
 * carrying either duel number — the pitch is the vault's secret (ADR-0014,
 * AGENTS.md game integrity).
 */
export type DuelSituation = Pick<
  RevealScenario,
  'opponent' | 'inning' | 'half' | 'outs' | 'scoreBefore' | 'hitsBefore'
>

export const OUTCOME_NAMES: Record<OutcomeKey, string> = {
  HR: 'HOME RUN!',
  '3B': 'TRIPLE!',
  '2B': 'DOUBLE!',
  '1B': 'SINGLE!',
  IF1B: 'INFIELD HIT!',
  BB: 'WALK',
  FO: 'FLY OUT',
  PO: 'POP OUT',
  GB: 'GROUNDOUT',
  K: 'STRIKEOUT',
}

const HIT_OUTCOMES: ReadonlySet<OutcomeKey> = new Set(['HR', '3B', '2B', '1B', 'IF1B'])

export const isHit = (outcome: OutcomeKey): boolean => HIT_OUTCOMES.has(outcome)

/** Base held breath (seconds) between the second flap and the outcome. */
const OUTCOME_HOLD = new Map<OutcomeKey, number>([
  ['HR', 1.5],
  ['3B', 1.2],
  ['2B', 1.0],
  ['1B', 0.8],
  ['IF1B', 0.8],
  ['BB', 0.6],
  ['FO', 0.6],
  ['PO', 0.6],
  ['GB', 0.6],
  ['K', 1.2],
])

/** Cap on situational boost so stacked drama can't make the beat drag. */
const MAX_SITUATION_BOOST = 1.2

export interface DramaTags {
  rbi: boolean
  leadChange: boolean
  newTie: boolean
  walkOff: boolean
  lateAndClose: boolean
}

export interface Drama {
  tags: DramaTags
  /** Headline chip shown under the outcome, or null when the play is routine. */
  callout: string | null
  /** Total held-breath seconds: outcome base + situational boost. */
  hold: number
}

function computeTags(scenario: RevealScenario, after: number): DramaTags {
  const { outcome, runsScored, scoreBefore, inning, half } = scenario
  return {
    rbi: runsScored > 0 && isHit(outcome),
    leadChange: scoreBefore.you <= scoreBefore.opp && after > scoreBefore.opp,
    newTie: runsScored > 0 && after === scoreBefore.opp,
    walkOff: half === 'BOTTOM' && inning >= 9 && after > scoreBefore.opp,
    lateAndClose: inning >= 7 && Math.abs(scoreBefore.you - scoreBefore.opp) <= 1,
  }
}

function computeCallout(
  tags: DramaTags,
  after: number,
  opp: number,
  runsScored: number,
): string | null {
  if (tags.walkOff) return 'WALK-OFF WIN!'
  if (tags.leadChange) return `LEAD CHANGE — YOU LEAD ${after}–${opp}`
  if (tags.newTie) return `ALL TIED AT ${after}`
  if (tags.rbi) return runsScored === 1 ? 'RBI' : `${runsScored} RBI`
  return null
}

function computeBoost(tags: DramaTags): number {
  return (
    (tags.walkOff ? 0.9 : 0) +
    (tags.leadChange ? 0.5 : 0) +
    (tags.newTie ? 0.3 : 0) +
    (tags.lateAndClose ? 0.4 : 0) +
    (tags.rbi ? 0.2 : 0)
  )
}

/**
 * Situational drama: leverage scales the reveal's pacing and names the
 * headline. Priority: walk-off > lead change > new tie > RBI.
 */
export function deriveDrama(scenario: RevealScenario): Drama {
  const after = scenario.scoreBefore.you + scenario.runsScored
  const tags = computeTags(scenario, after)
  return {
    tags,
    callout: computeCallout(tags, after, scenario.scoreBefore.opp, scenario.runsScored),
    hold:
      (OUTCOME_HOLD.get(scenario.outcome) ?? 0) + Math.min(computeBoost(tags), MAX_SITUATION_BOOST),
  }
}

const ORDINALS = ['', '1ST', '2ND', '3RD', '4TH', '5TH', '6TH', '7TH', '8TH', '9TH']

export function formatInning(scenario: Pick<RevealScenario, 'inning' | 'half'>): string {
  const ordinal = ORDINALS[scenario.inning] ?? `${scenario.inning}TH`
  return `${scenario.half === 'TOP' ? 'TOP' : 'BOT'} ${ordinal}`
}
