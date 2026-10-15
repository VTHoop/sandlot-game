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

/** The part of a window client a tap needs. */
export interface WindowLike {
  url: string
  focus(): Promise<unknown>
  navigate(url: string): Promise<unknown>
}

/** The part of the worker's `clients` a tap needs. */
export interface ClientsLike {
  matchAll(options: { type: 'window'; includeUncontrolled: true }): Promise<WindowLike[]>
  openWindow(url: string): Promise<unknown>
}

const FALLBACK_TITLE = 'Your turn'
const HOME = '/'

function fieldOf(parsed: unknown, key: 'title' | 'body' | 'url'): string | undefined {
  if (typeof parsed !== 'object' || parsed === null) return undefined
  const value = (parsed as Record<string, unknown>)[key]
  return typeof value === 'string' ? value : undefined
}

function parse(raw: string): unknown {
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

export function turnNotificationOf(raw: string): TurnNotification {
  const parsed = parse(raw)
  const title = fieldOf(parsed, 'title')
  const url = fieldOf(parsed, 'url') ?? HOME
  return {
    title: title ?? FALLBACK_TITLE,
    // One notification per game: a reminder replaces the push it repeats.
    options: { body: fieldOf(parsed, 'body'), tag: url, data: { url } },
  }
}

/** Open `url`: in a window that is already open, if there is one, else a new one. */
export async function openGameWindow(clients: ClientsLike, url: string): Promise<void> {
  const [open] = await clients.matchAll({ type: 'window', includeUncontrolled: true })
  if (!open) {
    await clients.openWindow(url)
    return
  }
  await open.navigate(url)
  await open.focus()
}
