/**
 * The pre-start `games` envelope: nothing has happened yet. The one definition
 * every game creator spreads in — the dev seed (`seed.ts`) and pickup games
 * (`pickup.ts`, SAN-78) — so a field added to `games` is added once.
 */
export const SCHEDULED_GAME = {
  inning: 1,
  half: 'top',
  outs: 0,
  bases: { first: null, second: null, third: null },
  homeScore: 0,
  awayScore: 0,
  status: 'scheduled',
  currentBatter: null,
  currentPitcher: null,
  homeBattingIndex: 0,
  awayBattingIndex: 0,
  // No at-bat has been folded in yet (schema.ts) — the engine seeds from -1.
  lastResolvedSequence: -1,
} as const
