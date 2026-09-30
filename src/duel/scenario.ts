import { REGULATION_INNINGS } from '@sandlot/engine/game'
import type { OutcomeKey } from '../components/ui/OutcomeLadder'
import type { TeamLine } from '../components/ui/Scoreboard'
import { DuelSeat } from './seatAgent'

/**
 * A node on the base-running path — where a runner starts or ends on the reveal's
 * field. An enum (not a literal union) per the project's finite-value-set
 * convention. `Batter` (the plate) is where a runner steps in, and also where a
 * strikeout / air out is retired in place; `Home` is a scored run. The three bases
 * can be either end of a journey, including the base a force out is recorded at.
 */
export enum FieldSpot {
  Batter = 'batter',
  First = 'first',
  Second = 'second',
  Third = 'third',
  Home = 'home',
}

/**
 * One runner's journey across the play, so the reveal animates the REAL base
 * running rather than a canned flourish: the batter (and each on-base runner)
 * traced from where they started (`from`) to where they ended (`to`). A held
 * runner has `from === to`; a scorer ends at `Home`. A retired runner carries
 * `retired: true` and a real `to` — the base the out was recorded at (a force out
 * ends at the base the runner was forced to; an air out / strikeout is retired in
 * place, `from === to`), so the reveal fades them WHERE the out happened rather
 * than at their starting spot. Derived in the adapter from the engine's
 * before/after base state plus the ground-ball sub-result, which together locate
 * the out (before/after alone cannot).
 */
export interface RunnerMovement {
  from: FieldSpot
  to: FieldSpot
  /** True when this runner was retired on the play; `to` is where the out occurred. */
  retired: boolean
}

/** One value per club, in absolute terms — never "you" and "them". */
export interface ClubPair<T> {
  away: T
  home: T
}

/** How many characters of a club's name its scoreboard label keeps. */
const CLUB_LABEL_LENGTH = 3

/**
 * The scoreboard label for a club: the first three letters of its name,
 * uppercased ("Ridgeview Rail" → "RID"). Spaces and punctuation are skipped so a
 * two-word name does not spend a slot on the gap ("El Paso Suns" → "ELP").
 *
 * A stand-in until clubs carry a label of their own (SAN-68): two clubs whose
 * names open alike read alike here.
 */
export function clubLabel(name: string): string {
  return name
    .replace(/[^\p{L}\p{N}]/gu, '')
    .slice(0, CLUB_LABEL_LENGTH)
    .toUpperCase()
}

/**
 * A resolved at-bat, described by what happened rather than by who is looking
 * (SAN-39, ADR-0030): the two numbers are the pitch and the swing, the two
 * players are named, and every total is away/home. The same scenario therefore
 * reads correctly to the club that batted, the club that pitched, and an owner of
 * both — there is no perspective to get wrong. `half` says which club batted
 * (top = away, SAN-21).
 */
export interface RevealScenario {
  pitch: number
  swing: number
  /** The pitcher's display name. */
  pitcher: string
  /** The batter's display name. */
  batter: string
  /** Each club's scoreboard label. */
  clubs: ClubPair<string>
  outcome: OutcomeKey
  inning: number
  half: 'TOP' | 'BOTTOM'
  /** The outs on the board when the play began — what the scoreboard shows until
   * the outcome lands. */
  outsBefore: number
  /** The outs once the play is over. */
  outs: number
  /** Runs the batting team scored on this play. */
  runsScored: number
  scoreBefore: ClubPair<number>
  hitsBefore: ClubPair<number>
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
 * subset of `RevealScenario` that EXCLUDES `pitch`/`swing` (and the resolved
 * `outcome`/`scoreline`). The commit screen must be structurally incapable of
 * carrying either duel number — the pitch is the vault's secret (ADR-0014,
 * AGENTS.md game integrity).
 */
export type DuelSituation = Pick<
  RevealScenario,
  'pitcher' | 'batter' | 'clubs' | 'inning' | 'half' | 'outs' | 'scoreBefore' | 'hitsBefore'
> & {
  /**
   * Which bases are occupied right now, in lead order (third → first), so the
   * commit/waiting field can draw the REAL diamond instead of a decorative one
   * (SAN-51). Occupancy only — no runner identity and, like every other field
   * here, no number. Base spots only; `Batter`/`Home` never appear.
   */
  runnersOn: readonly FieldSpot[]
  /**
   * Who is on each occupied base, when the source can name them (SAN-39): the
   * field's description reads "T. JULIEN on 2nd" instead of "Runner on 2nd".
   * Absent on the showcase fixture, which has occupancy only.
   */
  runners?: readonly RunnerOnBase[]
}

/** A named runner and the base they stand on. */
export interface RunnerOnBase {
  spot: FieldSpot
  name: string
}

/** What the live field shows before the pitch: the batter standing in plus each
 * occupied base — the same opening frame the reveal's animation settles on, so
 * the commit/waiting field and the reveal field read as one diamond (SAN-51). */
export const liveFieldSpots = (situation: DuelSituation): readonly FieldSpot[] => [
  FieldSpot.Batter,
  ...situation.runnersOn,
]

// Internal: callers reach these through `outcomeName()` so the lookup stays off the
// object-injection sink. `satisfies` validates every OutcomeKey is named while
// keeping each value's literal type.
const OUTCOME_NAMES = {
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
} satisfies Record<OutcomeKey, string>

// The Record read through a Map, so callers look up a name without a variable-key
// index into `OUTCOME_NAMES` (the object-injection sink Codacy flags; cf. the
// adapter's OUTCOME_KEY_LOOKUP).
const OUTCOME_NAME_LOOKUP: ReadonlyMap<string, string> = new Map(Object.entries(OUTCOME_NAMES))

/** The display name for an outcome, looked up injection-safely. Throws on an
 * unknown key so a missing name fails loudly rather than yielding `undefined`. */
export function outcomeName(outcome: OutcomeKey): string {
  const name = OUTCOME_NAME_LOOKUP.get(outcome)
  if (!name) throw new RangeError(`unmapped outcome: ${outcome}`)
  return name
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

/**
 * The score as the club at bat sees it — the one place drama takes a side. Every
 * tag below is about the BATTING club (it is the one that can score on the play),
 * and which club that is follows the half: away bats the top, home the bottom
 * (SAN-21). This is not a viewer's perspective: it is the same for everyone
 * watching the at-bat.
 */
interface BattingScore {
  /** The batting club's scoreboard label. */
  label: string
  before: number
  after: number
  fielding: number
}

function battingScore(scenario: RevealScenario): BattingScore {
  const { half, clubs, scoreBefore, runsScored } = scenario
  return half === 'TOP'
    ? {
        label: clubs.away,
        before: scoreBefore.away,
        after: scoreBefore.away + runsScored,
        fielding: scoreBefore.home,
      }
    : {
        label: clubs.home,
        before: scoreBefore.home,
        after: scoreBefore.home + runsScored,
        fielding: scoreBefore.away,
      }
}

/**
 * The first inning that counts as late: the last two of regulation. Read off the
 * engine's own regulation length rather than restated here (one layer owns a
 * domain, AGENTS.md).
 */
const LATE_INNING = REGULATION_INNINGS - 1

function computeTags(scenario: RevealScenario, score: BattingScore): DramaTags {
  const { outcome, runsScored, inning, half } = scenario
  return {
    rbi: runsScored > 0 && isHit(outcome),
    leadChange: score.before <= score.fielding && score.after > score.fielding,
    newTie: runsScored > 0 && score.after === score.fielding,
    // Only the home club can walk off: it bats last, in the bottom half.
    walkOff: half === 'BOTTOM' && inning >= REGULATION_INNINGS && score.after > score.fielding,
    lateAndClose: inning >= LATE_INNING && Math.abs(score.before - score.fielding) <= 1,
  }
}

function computeCallout(tags: DramaTags, score: BattingScore, runsScored: number): string | null {
  if (tags.walkOff) return 'WALK-OFF!'
  if (tags.leadChange) return `LEAD CHANGE — ${score.label} LEADS ${score.after}–${score.fielding}`
  if (tags.newTie) return `ALL TIED AT ${score.after}`
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
  const score = battingScore(scenario)
  const tags = computeTags(scenario, score)
  return {
    tags,
    callout: computeCallout(tags, score, scenario.runsScored),
    hold:
      (OUTCOME_HOLD.get(scenario.outcome) ?? 0) + Math.min(computeBoost(tags), MAX_SITUATION_BOOST),
  }
}

/** What a scoreboard needs from a situation or a reveal. */
type Scored = Pick<RevealScenario, 'clubs' | 'scoreBefore' | 'hitsBefore'>

/**
 * The two scoreboard rows, away then home, as they stood BEFORE the at-bat. One
 * builder for the commit, waiting and reveal screens, so all three show the same
 * board.
 */
export function scoreboardLines(scored: Scored): ClubPair<TeamLine> {
  const { clubs, scoreBefore, hitsBefore } = scored
  return {
    away: { label: clubs.away, runs: scoreBefore.away, hits: hitsBefore.away },
    home: { label: clubs.home, runs: scoreBefore.home, hits: hitsBefore.home },
  }
}

/** A seat's occupant and what they commit: the pitcher's pitch, the batter's swing. */
export interface SeatCommitter {
  player: string
  act: 'pitch' | 'swing'
}

/** Who sits in a seat this at-bat, and the name of the number they owe. */
export function committerOf(
  seat: DuelSeat,
  situation: Pick<DuelSituation, 'pitcher' | 'batter'>,
): SeatCommitter {
  return seat === DuelSeat.Pitcher
    ? { player: situation.pitcher, act: 'pitch' }
    : { player: situation.batter, act: 'swing' }
}

/** The seat across the duel from this one. */
export const oppositeSeat = (seat: DuelSeat): DuelSeat =>
  seat === DuelSeat.Pitcher ? DuelSeat.Batter : DuelSeat.Pitcher

/** The header every duel screen wears: the away club at the home club. */
export const matchupTitle = (clubs: ClubPair<string>): string => `${clubs.away} @ ${clubs.home}`

const ORDINALS = ['', '1ST', '2ND', '3RD', '4TH', '5TH', '6TH', '7TH', '8TH', '9TH']

export function formatInning(scenario: Pick<RevealScenario, 'inning' | 'half'>): string {
  const ordinal = ORDINALS[scenario.inning] ?? `${scenario.inning}TH`
  return `${scenario.half === 'TOP' ? 'TOP' : 'BOT'} ${ordinal}`
}
