/**
 * What the service worker does with a turn push (SAN-23, ADR-0036): show it, and
 * open the game when it is tapped. Plain functions of the payload and the open
 * windows, so they are tested without a worker; `src/sw.ts` only wires them to
 * the worker's events.
 *
 * The payload is the server's `{ title, body, url }` and nothing else (it never
 * carries a duel number, see `convex/push.ts`). A payload that is not that still
 * shows something: a browser that is handed a push and shows nothing may revoke
 * the permission.
 */
export interface TurnNotification {
  title: string
  options: NotificationOptions & { data: { url: string } }
}

/** The part of a window client a tap needs. Function-valued properties, not
 * methods, so a test can hold and assert on one without detaching it. */
export interface WindowLike {
  url: string
  focus: () => Promise<unknown>
  navigate: (url: string) => Promise<unknown>
}

/** The part of the worker's `clients` a tap needs. */
export interface ClientsLike {
  matchAll: (options: { type: 'window'; includeUncontrolled: true }) => Promise<WindowLike[]>
  openWindow: (url: string) => Promise<unknown>
}

const FALLBACK_TITLE = 'Your turn'
const HOME = '/'

/** The text of a payload field, or undefined for anything that is not text. */
function text(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

interface Payload {
  title?: string
  body?: string
  url?: string
}

/** The server's payload fields, each only if it is text; `{}` for anything else. */
function payloadOf(raw: string): Payload {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return {}
  }
  if (typeof parsed !== 'object' || parsed === null) return {}
  return {
    title: 'title' in parsed ? text(parsed.title) : undefined,
    body: 'body' in parsed ? text(parsed.body) : undefined,
    url: 'url' in parsed ? text(parsed.url) : undefined,
  }
}

export function turnNotificationOf(raw: string): TurnNotification {
  const { title, body, url = HOME } = payloadOf(raw)
  return {
    title: title ?? FALLBACK_TITLE,
    // One notification per game: a reminder replaces the push it repeats.
    options: { body, tag: url, data: { url } },
  }
}

/** Where a tapped notification goes: the url its data carries, else home. */
export function urlOf(data: unknown): string {
  if (typeof data !== 'object' || data === null || !('url' in data)) return HOME
  return text(data.url) ?? HOME
}

/** Whether `open` could be taken to `url`. A window this worker does not control
 * refuses, and the tap must still do something. */
function navigated(open: WindowLike, url: string): Promise<boolean> {
  return open.navigate(url).then(
    () => true,
    () => false,
  )
}

/** Open `url`: in a window that is already open, if it will go there, else a new one. */
export async function openGameWindow(clients: ClientsLike, url: string): Promise<void> {
  // Typed as possibly absent: with no open window there is nothing at index 0.
  const [open]: (WindowLike | undefined)[] = await clients.matchAll({
    type: 'window',
    includeUncontrolled: true,
  })
  if (open && (await navigated(open, url))) {
    await open.focus()
    return
  }
  await clients.openWindow(url)
}
