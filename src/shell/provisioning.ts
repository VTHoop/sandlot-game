import { useMutation } from 'convex/react'
import { useEffect, useState } from 'react'
import { api } from '../../convex/_generated/api'

export enum Provisioning {
  Pending = 'pending',
  Failed = 'failed',
  Ready = 'ready',
}

/**
 * Calls `users.provision` once per mount, so a signed-in user has a `users` row
 * before any gated function runs (ADR-0023). A retry is a remount — the caller
 * re-keys the component — so one attempt's state never leaks into the next.
 *
 * The mutation is idempotent, so StrictMode's doubled dev effect is harmless;
 * the `current` flag only stops a discarded attempt from writing state.
 */
export function useProvisioning(): Provisioning {
  const provision = useMutation(api.users.provision)
  const [state, setState] = useState(Provisioning.Pending)

  useEffect(() => {
    let current = true
    const settle = (next: Provisioning) => {
      if (current) setState(next)
    }
    provision().then(
      () => settle(Provisioning.Ready),
      () => settle(Provisioning.Failed),
    )
    return () => {
      current = false
    }
  }, [provision])

  return state
}
