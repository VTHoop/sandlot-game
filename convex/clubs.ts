import { v } from 'convex/values'
import type { Id } from './_generated/dataModel'
import { mutation, query } from './_generated/server'

/**
 * Self-serve club claiming (SAN-63) — red checkpoint. Declared so the suite
 * compiles, unimplemented so it fails.
 */

/** What the availability read has to say to the caller. */
export enum ClaimStatus {
  Unauthenticated = 'unauthenticated',
  Available = 'available',
  Holding = 'holding',
  NoneLeft = 'none_left',
}

/** Enough club identity to choose between clubs, and nothing else. */
export interface ClubSummary {
  id: Id<'teams'>
  name: string
}

export type ClubAvailability =
  | { status: ClaimStatus.Unauthenticated }
  | { status: ClaimStatus.Available; clubs: ClubSummary[] }
  | { status: ClaimStatus.Holding; club: ClubSummary }
  | { status: ClaimStatus.NoneLeft }

export const availability = query({
  args: {},
  handler: (): Promise<ClubAvailability> => {
    throw new Error('clubs.availability is not implemented yet')
  },
})

export const claim = mutation({
  args: { team: v.id('teams') },
  handler: (): Promise<void> => {
    throw new Error('clubs.claim is not implemented yet')
  },
})
