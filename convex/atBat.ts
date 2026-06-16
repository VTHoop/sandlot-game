import type { BaseState } from '@sandlot/engine/atBat'
import type { OutcomeBandKey } from '@sandlot/engine/outcomes'
import { v } from 'convex/values'
import { mutation, query } from './_generated/server'

/**
 * Participant-facing view of the current duel. Numbers are present only once the
 * swing has locked (`status: 'resolved'`) — never while a pitch is in the vault
 * awaiting a swing, and never for a non-participant (who receives `null`).
 */
export interface DuelView {
  status: 'awaiting_pitch' | 'awaiting_swing' | 'resolved'
  sequence: number
  pitchCommitted: boolean
  pitchNumber?: number
  batterNumber?: number
  outcome?: OutcomeBandKey
  runsScored?: number
  rbi?: number
  outsAfter?: number
  basesAfter?: BaseState
}

export const commitPitch = mutation({
  args: { game: v.id('games'), number: v.float64() },
  handler: async () => {
    throw new Error('not implemented')
  },
})

export const commitSwing = mutation({
  args: { game: v.id('games'), number: v.float64() },
  handler: async () => {
    throw new Error('not implemented')
  },
})

export const getActiveDuel = query({
  args: { game: v.id('games') },
  handler: async (): Promise<DuelView | null> => {
    throw new Error('not implemented')
  },
})
