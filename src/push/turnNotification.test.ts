import { describe, expect, it, vi } from 'vitest'
import {
  type ClientsLike,
  openGameWindow,
  turnNotificationOf,
  urlOf,
  type WindowLike,
} from './turnNotification'

/**
 * The service worker's two decisions (SAN-23): what a push shows, and where a tap
 * goes. Both are plain functions of the payload and the open windows, so they run
 * here without a worker.
 */

const PAYLOAD = JSON.stringify({
  title: 'Your turn vs Ridgeview Rail',
  body: 'Top 3 · Harbor Kingfishers 2, Ridgeview Rail 5',
  url: '/game/game-1',
})

describe('what a turn push shows', () => {
  it('shows the server’s title and body, and remembers which game it is for', () => {
    const { title, options } = turnNotificationOf(PAYLOAD)

    expect(title).toBe('Your turn vs Ridgeview Rail')
    expect(options.body).toBe('Top 3 · Harbor Kingfishers 2, Ridgeview Rail 5')
    expect(options.data).toEqual({ url: '/game/game-1' })
  })

  it('tags it by game, so a reminder replaces the push it repeats instead of stacking', () => {
    expect(turnNotificationOf(PAYLOAD).options.tag).toBe('/game/game-1')
  })

  it('still shows something, and opens the app, when the payload is not what was expected', () => {
    for (const raw of ['not json', '{}', '{"title":3}', 'null']) {
      const { title, options } = turnNotificationOf(raw)

      expect(title).toBe('Your turn')
      expect(options.data).toEqual({ url: '/' })
    }
  })
})

function windowAt(url: string): WindowLike {
  return {
    url,
    focus: vi.fn().mockResolvedValue(undefined),
    navigate: vi.fn().mockResolvedValue(null),
  }
}

function clientsWith(...windows: WindowLike[]): ClientsLike {
  return {
    matchAll: vi.fn().mockResolvedValue(windows),
    openWindow: vi.fn().mockResolvedValue(null),
  }
}

describe('what a tap opens', () => {
  it('opens the game in a new window when the app is not open', async () => {
    const clients = clientsWith()

    await openGameWindow(clients, '/game/game-1')

    expect(clients.openWindow).toHaveBeenCalledExactlyOnceWith('/game/game-1')
  })

  it('takes an open window to the game and brings it forward, rather than opening another', async () => {
    const open = windowAt('https://sandlot.test/')
    const clients = clientsWith(open)

    await openGameWindow(clients, '/game/game-1')

    expect(open.navigate).toHaveBeenCalledExactlyOnceWith('/game/game-1')
    expect(open.focus).toHaveBeenCalledTimes(1)
    expect(clients.openWindow).not.toHaveBeenCalled()
  })

  it('looks at windows the worker does not yet control, since the app may have been open before it', async () => {
    const clients = clientsWith()

    await openGameWindow(clients, '/game/game-1')

    expect(clients.matchAll).toHaveBeenCalledWith({ type: 'window', includeUncontrolled: true })
  })
})

describe('a tap on a window this worker does not control', () => {
  it('opens a new window when the open one refuses to navigate, so the tap still does something', async () => {
    const uncontrolled = windowAt('https://sandlot.test/')
    uncontrolled.navigate = vi.fn().mockRejectedValue(new TypeError('not controlled'))
    const clients = clientsWith(uncontrolled)

    await openGameWindow(clients, '/game/game-1')

    expect(clients.openWindow).toHaveBeenCalledExactlyOnceWith('/game/game-1')
  })
})

describe('where a tapped notification goes', () => {
  it('reads the game’s url from the notification’s data', () => {
    expect(urlOf({ url: '/game/game-1' })).toBe('/game/game-1')
  })

  it('goes home when the data is not a url', () => {
    for (const data of [undefined, null, 'x', {}, { url: 3 }]) expect(urlOf(data)).toBe('/')
  })
})
