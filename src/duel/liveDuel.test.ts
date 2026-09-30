import { Half } from '@sandlot/engine/game'
import { describe, expect, it } from 'vitest'
import type { ResolvedAtBatView } from '../../convex/duelContract'
import { ClubSide, SeatRole } from '../../convex/gameView'
import {
  halfSummaryOf,
  matchupOf,
  RevealAdvance,
  revealAdvanceOf,
  revealOf,
  sideChangeOf,
  situationOf,
  TurnKind,
  turnFor,
} from './liveDuel'
import { FieldSpot } from './scenario'
import { DuelSeat } from './seatAgent'
import { CLUBS, finalView, liveView, locks, owns, player, resolvedAtBat } from './testing/liveViews'

describe('turnFor — which seat this client drives', () => {
  it('gives an away-only owner the batter’s seat in the top half', () => {
    expect(turnFor(liveView({ viewerOwns: owns(false, true) }))).toEqual({
      kind: TurnKind.Commit,
      seat: DuelSeat.Batter,
      opponentLocked: false,
    })
  })

  it('gives an away-only owner the pitcher’s seat in the bottom half', () => {
    expect(turnFor(liveView({ half: Half.Bottom, viewerOwns: owns(false, true) }))).toEqual({
      kind: TurnKind.Commit,
      seat: DuelSeat.Pitcher,
      opponentLocked: false,
    })
  })

  it('gives a home-only owner the pitcher’s seat in the top half', () => {
    expect(turnFor(liveView({ viewerOwns: owns(true, false) }))).toMatchObject({
      kind: TurnKind.Commit,
      seat: DuelSeat.Pitcher,
    })
  })

  it('tells the seat it prompts THAT the other seat has locked — the bot went first', () => {
    // Order-independent (ADR-0014): the pitch is already on file when the batter
    // is first shown the at-bat.
    expect(turnFor(liveView({ locks: locks(true, false) }))).toEqual({
      kind: TurnKind.Commit,
      seat: DuelSeat.Batter,
      opponentLocked: true,
    })
  })

  it('prompts an owner of both clubs for the pitcher, then the batter', () => {
    const both = owns(true, true)
    expect(turnFor(liveView({ viewerOwns: both }))).toEqual({
      kind: TurnKind.Commit,
      seat: DuelSeat.Pitcher,
      opponentLocked: false,
    })
    expect(turnFor(liveView({ viewerOwns: both, locks: locks(true, false) }))).toEqual({
      kind: TurnKind.Commit,
      seat: DuelSeat.Batter,
      opponentLocked: true,
    })
  })

  it('prompts an owner of both only for the seat still open, whichever it is', () => {
    expect(turnFor(liveView({ viewerOwns: owns(true, true), locks: locks(false, true) }))).toEqual({
      kind: TurnKind.Commit,
      seat: DuelSeat.Pitcher,
      opponentLocked: true,
    })
  })

  it('never prompts for a seat that has already locked', () => {
    // The viewer's own seat is on file: nothing left for them to commit.
    expect(turnFor(liveView({ locks: locks(false, true) }))).toEqual({
      kind: TurnKind.Waiting,
      waitingOn: DuelSeat.Pitcher,
    })
  })

  it('waits on the seat that is still open when the viewer owns neither open seat', () => {
    // Away owner, bottom half: they pitch, and have. The home batter has not swung.
    expect(turnFor(liveView({ half: Half.Bottom, locks: locks(true, false) }))).toEqual({
      kind: TurnKind.Waiting,
      waitingOn: DuelSeat.Batter,
    })
  })

  it('decides from what the viewer owns, not from `viewer` or `viewerSeat`', () => {
    // An owner of both clubs reads as the home side, seated as the pitcher in the
    // top half (home and batting are checked first on the server). Trusting those
    // would never prompt them for the swing.
    const hotseat = liveView({
      viewer: ClubSide.Home,
      viewerSeat: SeatRole.Pitching,
      viewerOwns: owns(true, true),
      locks: locks(true, false),
    })
    expect(turnFor(hotseat)).toMatchObject({ kind: TurnKind.Commit, seat: DuelSeat.Batter })
  })
})

describe('situationOf — the commit and waiting screens’ input', () => {
  it('reads the situation straight off the server’s view, absolute', () => {
    expect(situationOf(liveView())).toEqual({
      pitcher: 'H. MARSH',
      batter: 'R. VANCE',
      clubs: { away: 'HAR', home: 'RID' },
      inning: 3,
      half: 'TOP',
      outs: 1,
      scoreBefore: { away: 1, home: 2 },
      hitsBefore: { away: 4, home: 5 },
      runnersOn: [FieldSpot.Second],
      runners: [{ spot: FieldSpot.Second, name: 'T. JULIEN' }],
    })
  })

  it('names every runner, in lead order', () => {
    const situation = situationOf(
      liveView({
        bases: {
          first: player('r1', 'S. ORTIZ'),
          second: player('r2', 'T. JULIEN'),
          third: player('r3', 'C. DIAZ'),
        },
      }),
    )
    expect(situation.runnersOn).toEqual([FieldSpot.Third, FieldSpot.Second, FieldSpot.First])
    expect(situation.runners).toEqual([
      { spot: FieldSpot.Third, name: 'C. DIAZ' },
      { spot: FieldSpot.Second, name: 'T. JULIEN' },
      { spot: FieldSpot.First, name: 'S. ORTIZ' },
    ])
  })

  it('carries neither duel number (secret-state law)', () => {
    const situation = situationOf(liveView({ locks: locks(true, true) }))
    expect(situation).not.toHaveProperty('pitch')
    expect(situation).not.toHaveProperty('swing')
  })
})

describe('matchupOf', () => {
  it('names the pitcher, the batter and who is due up, with attrs as pips', () => {
    expect(matchupOf(liveView())).toEqual({
      pitcher: { name: 'H. MARSH', attrs: { VEL: 3, MOV: 4, CMD: 2 } },
      batter: { name: 'R. VANCE', attrs: { PWR: 3, CON: 4, SPD: 3, EYE: 5 } },
      dueUp: ['S. ORTIZ', 'C. DIAZ'],
    })
  })
})

describe('revealOf — the reveal, built from the server’s resolved at-bat', () => {
  it('renders the server’s numbers, players, outcome and pre-play board', () => {
    expect(revealOf(resolvedAtBat(), CLUBS)).toEqual({
      pitch: 519,
      swing: 472,
      pitcher: 'G. PIKE',
      batter: 'J. WHITLOCK',
      clubs: { away: 'HAR', home: 'RID' },
      outcome: '2B',
      inning: 3,
      half: 'BOTTOM',
      outsBefore: 1,
      outs: 1,
      runsScored: 1,
      scoreBefore: { away: 3, home: 2 },
      hitsBefore: { away: 6, home: 5 },
      headline: 'DOUBLE!',
      scoreline: '1 run scores · J. WHITLOCK stands on 2nd',
      movements: [
        { from: FieldSpot.Second, to: FieldSpot.Home, retired: false },
        { from: FieldSpot.Batter, to: FieldSpot.Second, retired: false },
      ],
    })
  })

  it('names a ground ball by its sub-result, as the fixture path does', () => {
    const reveal = revealOf(
      resolvedAtBat({
        outcome: 'GB',
        groundBallResult: 'DP' as ResolvedAtBatView['groundBallResult'],
        runsScored: 0,
        outsAfter: 3,
        basesBefore: { first: 'r9', second: null, third: null },
        basesAfter: { first: null, second: null, third: null },
      }),
      CLUBS,
    )
    expect(reveal.headline).toBe('DOUBLE PLAY')
    expect(reveal.outs).toBe(3)
  })
})

describe('halfSummaryOf', () => {
  it('reports the half the at-bat ended, with the batting club’s totals', () => {
    expect(
      halfSummaryOf(resolvedAtBat({ endedHalf: true, halfTotals: { runs: 2, hits: 3 } }), CLUBS),
    ).toMatchObject({ half: 'BOTTOM', inning: 3, runs: 2, hits: 3 })
  })

  it('carries the game score once the at-bat is in, by club label (SAN-70)', () => {
    // The bottom of the 3rd: RID had 2 and this play scored 1 more.
    const summary = halfSummaryOf(
      resolvedAtBat({ endedHalf: true, scoreBefore: { away: 3, home: 2 }, runsScored: 1 }),
      CLUBS,
    )
    expect(summary).toMatchObject({
      clubs: { away: 'HAR', home: 'RID' },
      score: { away: 3, home: 3 },
    })
  })
})

describe('revealAdvanceOf — where advancing past a reveal leads', () => {
  const PLAY = resolvedAtBat({ sequence: 40, endedHalf: false })
  const THIRD_OUT = resolvedAtBat({ sequence: 40, outsAfter: 3, endedHalf: true })

  it('goes to the next batter after a play that did not end the half', () => {
    expect(revealAdvanceOf(PLAY, PLAY, liveView())).toBe(RevealAdvance.NextBatter)
  })

  it('goes to the half’s summary after the third out', () => {
    expect(revealAdvanceOf(THIRD_OUT, THIRD_OUT, liveView())).toBe(RevealAdvance.EndOfHalf)
  })

  it('goes to the final score after the at-bat that ended the game — a walk-off ends no half', () => {
    expect(revealAdvanceOf(PLAY, PLAY, finalView())).toBe(RevealAdvance.FinalScore)
  })

  it('goes to the final score after a last out, not to a half summary', () => {
    expect(revealAdvanceOf(THIRD_OUT, THIRD_OUT, finalView())).toBe(RevealAdvance.FinalScore)
  })

  it('does not call an older reveal the final one when the game ended under it', () => {
    // Possible from a second tab or device: the game-ending at-bat is newer, and
    // it is revealed next.
    const ending = resolvedAtBat({ sequence: 41 })
    expect(revealAdvanceOf(PLAY, ending, finalView())).toBe(RevealAdvance.NextBatter)
    expect(revealAdvanceOf(THIRD_OUT, ending, finalView())).toBe(RevealAdvance.EndOfHalf)
  })
})

describe('sideChangeOf — the half the server has opened', () => {
  it('names the away club batting in the top half', () => {
    expect(sideChangeOf(liveView({ inning: 4, half: Half.Top }))).toEqual({
      inning: 4,
      half: 'TOP',
      batting: CLUBS.away.name,
    })
  })

  it('names the home club batting in the bottom half', () => {
    expect(sideChangeOf(liveView({ inning: 3, half: Half.Bottom }))).toEqual({
      inning: 3,
      half: 'BOTTOM',
      batting: CLUBS.home.name,
    })
  })
})
