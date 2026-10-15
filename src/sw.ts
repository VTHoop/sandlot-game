import { cleanupOutdatedCaches, precacheAndRoute } from 'workbox-precaching'
import { type ClientsLike, openGameWindow, turnNotificationOf } from './push/turnNotification'

/**
 * The app's service worker (SAN-23, ADR-0036): the precache `vite-plugin-pwa`
 * generated before, plus the two events web push needs. What each does is in
 * `./push/turnNotification`; this file only wires them to the worker.
 *
 * Typed by hand rather than with the `webworker` lib, which cannot share a
 * project with the DOM lib the rest of `src` is checked against.
 */
interface WorkerEvent {
  waitUntil(work: Promise<unknown>): void
}
interface PushEvent extends WorkerEvent {
  data: { text(): string } | null
}
interface NotificationClickEvent extends WorkerEvent {
  notification: { close(): void; data: unknown }
}
/** Workbox replaces the literal `self.__WB_MANIFEST` at build time, so the precache
 * list has to be read off `self` by that exact spelling. */
interface Manifested {
  __WB_MANIFEST: { url: string; revision: string | null }[]
}
interface WorkerScope {
  clients: ClientsLike & { claim(): Promise<void> }
  registration: { showNotification(title: string, options: NotificationOptions): Promise<void> }
  skipWaiting(): Promise<void>
  addEventListener(type: 'install' | 'activate', listener: (event: WorkerEvent) => void): void
  addEventListener(type: 'push', listener: (event: PushEvent) => void): void
  addEventListener(
    type: 'notificationclick',
    listener: (event: NotificationClickEvent) => void,
  ): void
}

const worker = self as unknown as WorkerScope

cleanupOutdatedCaches()
precacheAndRoute((self as unknown as Manifested).__WB_MANIFEST)

// Same behavior as `registerType: 'autoUpdate'`: a new worker takes over at once.
worker.addEventListener('install', () => {
  void worker.skipWaiting()
})
worker.addEventListener('activate', (event) => {
  event.waitUntil(worker.clients.claim())
})

worker.addEventListener('push', (event) => {
  const { title, options } = turnNotificationOf(event.data?.text() ?? '')
  event.waitUntil(worker.registration.showNotification(title, options))
})

worker.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const data = event.notification.data
  const url = typeof data === 'object' && data !== null && 'url' in data ? String(data.url) : '/'
  event.waitUntil(openGameWindow(worker.clients, url))
})
