import { SignIn } from '@clerk/react'
import { useState } from 'react'
import { Outlet, useLocation } from 'react-router'
import { Button } from '../components/ui/Button'
import { Provisioning, useProvisioning } from './provisioning'
import { Screen, WaitingScreen, Wordmark } from './Screen'
import { Session, useSession } from './session'

/**
 * The gate in front of every authenticated route: signed out → sign in; signed
 * in → provision; provisioned → the matched route (`<Outlet />`). No route
 * behind it mounts, and so no gated query runs, until the viewer has a
 * `users` row.
 */
export function AuthGate() {
  const session = useSession()
  if (session === Session.SignedOut) return <SignInScreen />
  if (session === Session.Pending) return <WaitingScreen>Checking your sign-in…</WaitingScreen>
  return <ProvisionGate />
}

/**
 * Clerk's prebuilt sign-in, rendered in place at whatever URL the visitor
 * opened. Hash routing keeps Clerk's own steps (`#/factor-one`, …) off the app's
 * paths, and forcing the redirect to the current path + query returns a deep
 * link like `/game/:id` to itself after signing in — or signing up.
 */
function SignInScreen() {
  const { pathname, search } = useLocation()
  const returnTo = `${pathname}${search}`
  return (
    <Screen>
      <Wordmark />
      <SignIn routing="hash" forceRedirectUrl={returnTo} signUpForceRedirectUrl={returnTo} />
    </Screen>
  )
}

/** Each retry remounts the attempt, so it starts from a clean pending state. */
function ProvisionGate() {
  const [attempt, setAttempt] = useState(0)
  return <ProvisionAttempt key={attempt} onRetry={() => setAttempt((n) => n + 1)} />
}

function ProvisionAttempt({ onRetry }: { onRetry: () => void }) {
  const state = useProvisioning()
  if (state === Provisioning.Ready) return <Outlet />
  if (state === Provisioning.Pending) {
    return <WaitingScreen>Setting up your account…</WaitingScreen>
  }
  return (
    <Screen>
      <Wordmark />
      <p role="alert" className="text-sm text-chalk">
        We couldn’t set up your account.
      </p>
      <Button onClick={onRetry} className="px-5 py-3 text-sm">
        Retry
      </Button>
    </Screen>
  )
}
