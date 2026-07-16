import { isDuelNumber } from '@sandlot/engine/atBat'
import type { AppliedAtBat } from '@sandlot/engine/game'
import { GameStatus, Half, type LiveGameState } from '@sandlot/engine/game'
import { describe, expect, it } from 'vitest'
import type { OutcomeKey } from '../../components/ui/OutcomeLadder'
import type { DuelAdapter, HitTotals } from './adapter'
import { createBotAgent } from './botAgent'
import { playHalfInning, type RevealGate, type SeatAgents } from './duelLoop'
import type { Roster } from './roster'
import { OUTCOME_NAMES, type RevealScenario } from './scenario'
import { DuelSeat, type SeatAgent, type SeatCommitRequest } from './seatAgent'

// A one-pitcher roster is all `deriveSituation` needs to name the opponent.
const ROSTER: Roster = new Map([
  [
    'P',
    { name: 'ARM', attributes: { velocity: 3, movement: 3, awareness: 3, command: 3 }, speed: 1 },
  ],
])

function liveTop(): LiveGameState {
  return {
    status: GameStatus.Live,
    inning: 1,
    half: Half.Top,
    outs: 0,
    bases: { first: null, second: null, third: null },
    homeScore: 0,
    awayScore: 0,
    homeBattingIndex: 0,
    awayBattingIndex: 0,
    currentBatter: 'away-1',
    currentPitcher: 'P',
    lastResolvedSequence: -1,
  }
}

const APPLIED: AppliedAtBat = {
  sequence: 0,
  outsBefore: 0,
  outsAfter: 0,
  basesAfter: { first: null, second: null, third: null },
  runsScored: 0,
}

function fakeReveal(outcome: OutcomeKey, runsScored = 0): RevealScenario {
  return {
    you: 0,
    them: 0,
    opponent: 'ARM',
    outcome,
    inning: 1,
    half: 'TOP',
    outs: 0,
    runsScored,
    scoreBefore: { you: 0, opp: 0 },
    hitsBefore: { you: 0, opp: 0 },
    scoreline: '',
    headline: OUTCOME_NAMES[outcome],
    // The loop never renders the field; movements only matter to the reveal UI.
    movements: [],
  }
}

/**
 * A deterministic fake adapter: it stays in the top half until `reveals.length`
 * at-bats have played, then reports the bottom half so the loop's half-over guard
 * fires. It records the committed (pitch, swing) pairs so a test can assert what
 * flowed into resolution.
 */
function fakeAdapter(reveals: RevealScenario[]): {
  adapter: DuelAdapter
  commits: Array<{ pitch: number; swing: number }>
} {
  const commits: Array<{ pitch: number; swing: number }> = []
  const hits: HitTotals = { you: 0, opp: 0 }
  // Consume from a copy so the loop drains reveals in order without a computed
  // index (which would trip the object-injection sink) or mutating the argument.
  const queue = [...reveals]
  const adapter: DuelAdapter = {
    state: () => (queue.length === 0 ? { ...liveTop(), half: Half.Bottom } : liveTop()),
    hits: () => ({ ...hits }),
    playAtBat: (pitch, swing) => {
      const reveal = queue.shift() ?? fakeReveal('K')
      commits.push({ pitch, swing })
      return { applied: APPLIED, reveal }
    },
  }
  return { adapter, commits }
}

const silentGate: RevealGate = { present: async () => {} }

describe('playHalfInning', () => {
  it('sequences each at-bat and never hands the batter seat the pitch (secret-state law)', async () => {
    const pitcher: SeatAgent = { requestNumber: async () => 731 }
    const batterRequests: SeatCommitRequest[] = []
    const batter: SeatAgent = {
      requestNumber: async (request) => {
        batterRequests.push(request)
        return 268
      },
    }
    const agents: SeatAgents = { [DuelSeat.Pitcher]: pitcher, [DuelSeat.Batter]: batter }
    const { adapter, commits } = fakeAdapter([fakeReveal('K'), fakeReveal('K'), fakeReveal('K')])

    await playHalfInning(adapter, ROSTER, agents, silentGate)

    // Both committed numbers reached resolution, in order, for all three at-bats.
    expect(commits).toEqual([
      { pitch: 731, swing: 268 },
      { pitch: 731, swing: 268 },
      { pitch: 731, swing: 268 },
    ])
    // The pitch (731) lives only in the loop: the batter agent's request carried
    // the non-secret situation and nothing that could encode the pitch.
    expect(batterRequests).toHaveLength(3)
    for (const request of batterRequests) {
      expect(request.seat).toBe(DuelSeat.Batter)
      expect(JSON.stringify(request)).not.toContain('731')
    }
  })

  it('sums the batting side’s runs and hits for the half', async () => {
    const agents = flatAgents(400, 300)
    const { adapter } = fakeAdapter([fakeReveal('1B'), fakeReveal('HR', 1), fakeReveal('K')])

    const summary = await playHalfInning(adapter, ROSTER, agents, silentGate)

    expect(summary).toEqual({ half: 'TOP', inning: 1, runs: 1, hits: 2 })
  })

  it('marks only the at-bat that ends the half as the final of the half', async () => {
    const agents = flatAgents(400, 300)
    const finals: boolean[] = []
    const gate: RevealGate = {
      present: async (_reveal, isFinalOfHalf) => {
        finals.push(isFinalOfHalf)
      },
    }
    const { adapter } = fakeAdapter([fakeReveal('K'), fakeReveal('K'), fakeReveal('K')])

    await playHalfInning(adapter, ROSTER, agents, gate)

    expect(finals).toEqual([false, false, true])
  })

  it('drives a bot seat without ever handing it the opponent’s number (secret-state law)', async () => {
    // A bot fills the batter seat; a recording wrapper captures every request the
    // seam hands it so we can assert what it was — and was not — shown.
    const received: SeatCommitRequest[] = []
    const bot = createBotAgent(() => 0.42)
    const batter: SeatAgent = {
      requestNumber: (request) => {
        received.push(request)
        return bot.requestNumber(request)
      },
    }
    const pitcher: SeatAgent = { requestNumber: async () => 731 }
    const agents: SeatAgents = { [DuelSeat.Pitcher]: pitcher, [DuelSeat.Batter]: batter }
    const { adapter, commits } = fakeAdapter([fakeReveal('K'), fakeReveal('K'), fakeReveal('K')])

    await playHalfInning(adapter, ROSTER, agents, silentGate)

    expect(received).toHaveLength(3)
    for (const request of received) {
      expect(request.seat).toBe(DuelSeat.Batter)
      // The pitch (731) lives only in the loop: it never reaches the bot seat.
      expect(JSON.stringify(request)).not.toContain('731')
    }
    // Every number the bot committed into resolution is a valid duel number.
    for (const { swing } of commits) {
      expect(isDuelNumber(swing)).toBe(true)
    }
  })

  it('throws rather than hanging when a broken adapter never ends the half', async () => {
    // A non-terminating adapter: its state stays in the top half forever, so the
    // loop's half-over guard never fires. The iteration cap must break the hang.
    let played = 0
    const stuck: DuelAdapter = {
      state: () => liveTop(),
      hits: () => ({ you: 0, opp: 0 }),
      playAtBat: () => {
        played += 1
        return { applied: APPLIED, reveal: fakeReveal('K') }
      },
    }

    await expect(playHalfInning(stuck, ROSTER, flatAgents(1, 2), silentGate)).rejects.toThrow(
      /exceeded/i,
    )
    // It stopped at the cap, not somewhere unbounded.
    expect(played).toBe(200)
  })
})

/** Two non-human agents that answer with fixed numbers — proves the loop drives a
 * seat that isn't a human without any change to the loop itself. */
function flatAgents(pitch: number, swing: number): SeatAgents {
  return {
    [DuelSeat.Pitcher]: { requestNumber: async () => pitch },
    [DuelSeat.Batter]: { requestNumber: async () => swing },
  }
}
