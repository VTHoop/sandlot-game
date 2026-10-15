/**
 * What the service worker does with a turn push (SAN-23): show it, and open the
 * game when it is tapped. Red checkpoint: the seam the tests are written
 * against, with no behavior behind it yet.
 */
export interface TurnNotification {
  title: string
  options: NotificationOptions & { data: { url: string } }
}

/** The part of `Clients` a tap needs, so it can be tested without a worker. */
export interface WindowLike {
  url: string
  focus(): Promise<unknown>
  navigate(url: string): Promise<unknown>
}

export interface ClientsLike {
  matchAll(options: { type: 'window'; includeUncontrolled: true }): Promise<WindowLike[]>
  openWindow(url: string): Promise<unknown>
}

export function turnNotificationOf(_raw: string): TurnNotification {
  throw new Error('turnNotificationOf is not implemented')
}

export async function openGameWindow(_clients: ClientsLike, _url: string): Promise<void> {
  throw new Error('openGameWindow is not implemented')
}
