import type { OutcomeKey } from '../../components/ui/OutcomeLadder'

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
}

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
const OUTCOME_HOLD: Record<OutcomeKey, number> = {
  HR: 1.5,
  '3B': 1.2,
  '2B': 1.0,
  '1B': 0.8,
  IF1B: 0.8,
  BB: 0.6,
  FO: 0.6,
  PO: 0.6,
  GB: 0.6,
  K: 1.2,
}

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
 * Situational drama: leverage scales the reveal's pacing and names the
 * headline. Priority: walk-off > lead change > new tie > RBI.
 */
export function deriveDrama(scenario: RevealScenario): Drama {
  const { outcome, runsScored, scoreBefore, inning, half } = scenario
  const after = scoreBefore.you + runsScored

  const tags: DramaTags = {
    rbi: runsScored > 0 && isHit(outcome),
    leadChange: scoreBefore.you <= scoreBefore.opp && after > scoreBefore.opp,
    newTie: runsScored > 0 && after === scoreBefore.opp,
    walkOff: half === 'BOTTOM' && inning >= 9 && after > scoreBefore.opp,
    lateAndClose: inning >= 7 && Math.abs(scoreBefore.you - scoreBefore.opp) <= 1,
  }

  const callout = tags.walkOff
    ? 'WALK-OFF WIN!'
    : tags.leadChange
      ? `LEAD CHANGE — YOU LEAD ${after}–${scoreBefore.opp}`
      : tags.newTie
        ? `ALL TIED AT ${after}`
        : tags.rbi
          ? runsScored === 1
            ? 'RBI'
            : `${runsScored} RBI`
          : null

  const boost =
    (tags.walkOff ? 0.9 : 0) +
    (tags.leadChange ? 0.5 : 0) +
    (tags.newTie ? 0.3 : 0) +
    (tags.lateAndClose ? 0.4 : 0) +
    (tags.rbi ? 0.2 : 0)

  return {
    tags,
    callout,
    hold: OUTCOME_HOLD[outcome] + Math.min(boost, MAX_SITUATION_BOOST),
  }
}

const ORDINALS = ['', '1ST', '2ND', '3RD', '4TH', '5TH', '6TH', '7TH', '8TH', '9TH']

export function formatInning(scenario: Pick<RevealScenario, 'inning' | 'half'>): string {
  const ordinal = ORDINALS[scenario.inning] ?? `${scenario.inning}TH`
  return `${scenario.half === 'TOP' ? 'TOP' : 'BOT'} ${ordinal}`
}
