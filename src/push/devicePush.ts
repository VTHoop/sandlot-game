/**
 * Registering this device for turn pushes (SAN-23, ADR-0036). Called when the
 * viewer's lock has landed, never on load: that is the moment the app has earned
 * the question, and a prompt on first load is one browsers learn to block.
 *
 * Every refusal here is silent. A browser with no push, a permission already
 * denied (the app never asks twice) or a missing server key all mean the player
 * plays exactly as before — only the callers that can recover from a throw
 * should see one.
 */
export interface DeviceSubscription {
  endpoint: string
  p256dh: string
  auth: string
}

function pushIsSupported(): boolean {
  return (
    typeof Notification !== 'undefined' &&
    typeof PushManager !== 'undefined' &&
    'serviceWorker' in navigator
  )
}

/** The VAPID public key as the bytes `PushManager.subscribe` wants. */
function applicationServerKey(base64Url: string): Uint8Array<ArrayBuffer> {
  const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='))
  return Uint8Array.from(binary, (char) => char.charCodeAt(0))
}

/** Whether the viewer has allowed notifications, asking only if they have not yet said. */
async function mayNotify(): Promise<boolean> {
  if (Notification.permission === 'denied') return false
  if (Notification.permission === 'granted') return true
  return (await Notification.requestPermission()) === 'granted'
}

function deviceOf(subscription: PushSubscription): DeviceSubscription | null {
  const { endpoint, keys } = subscription.toJSON()
  if (!endpoint || !keys?.p256dh || !keys.auth) return null
  return { endpoint, p256dh: keys.p256dh, auth: keys.auth }
}

export async function registerThisDevice(
  send: (device: DeviceSubscription) => Promise<unknown>,
): Promise<void> {
  const serverKey = import.meta.env.VITE_VAPID_PUBLIC_KEY
  if (!serverKey || !pushIsSupported() || !(await mayNotify())) return

  const { pushManager } = await navigator.serviceWorker.ready
  const subscription =
    (await pushManager.getSubscription()) ??
    (await pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: applicationServerKey(serverKey),
    }))
  const device = deviceOf(subscription)
  if (device) await send(device)
}
