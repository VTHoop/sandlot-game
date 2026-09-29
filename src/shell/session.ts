import { useAuth } from '@clerk/react'
import { useConvexAuth } from 'convex/react'

/** Where the viewer's session stands, as far as the shell gates on it. */
export enum Session {
  /** Clerk has not loaded, or the server has not yet accepted Clerk's token. */
  Pending = 'pending',
  SignedOut = 'signed-out',
  /** Signed in to Clerk, and Convex has confirmed the token. */
  SignedIn = 'signed-in',
}

/**
 * Clerk decides signed-in versus signed-out; Convex decides when a signed-in
 * session is usable. Both are needed because they disagree for a window: after
 * Clerk signs in, `useConvexAuth` reads `{ isLoading: false, isAuthenticated:
 * false }` until the backend confirms the token — and a token the backend
 * rejects reads identically. That window is therefore `Pending`, never
 * `SignedOut`: showing the sign-in surface to a Clerk-signed-in user would
 * bounce them straight back through Clerk's redirect.
 */
export function useSession(): Session {
  const clerk = useAuth()
  const convex = useConvexAuth()
  if (!clerk.isLoaded) return Session.Pending
  if (!clerk.isSignedIn) return Session.SignedOut
  return convex.isAuthenticated ? Session.SignedIn : Session.Pending
}
