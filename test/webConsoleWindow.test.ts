import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  CONSOLE_BRIDGE_PROP,
  CONSOLE_WINDOW_NAME,
  consoleHostAlive,
  consoleWindowUrl,
  installWebConsoleMain,
  installWebConsoleWindow,
  type ConsoleHostBridge
} from '../src/renderer/src/web/web-console'

/**
 * #810 — the console pop-out on the web app.
 *
 * The sibling of #781, and a worse failure than it first looked. `ShellPanel`
 * sets `poppedOut` BEFORE calling `console.open`, so on the web the docked
 * terminal was hidden behind a placeholder, no window opened, and **Redock was
 * dead too**: it calls `console.close()` and then waits for the `console:closed`
 * event to clear the flag, but both were preload-fallback stubs, so that event
 * could never arrive.
 *
 * That makes the `onClosed` event the thing worth testing hardest. Every route
 * out of a popped-out console — a normal close, a blocked pop-up, a window
 * closed behind the editor's back, the editor closing it itself — has to fire
 * it, because that event IS the console coming back. A test that only checked
 * "a window opened" would have passed against the original bug's worst symptom.
 *
 * The vitest environment is `node`, so there is no DOM. These build a fake
 * `window` and drive the real module against it — the lifecycle logic is the
 * part that broke, and it is all in this module rather than in the DOM.
 */

interface FakePopup {
  closed: boolean
  close: () => void
  focus: () => void
  focusCount: number
}

interface FakeWindow {
  api: Record<string, unknown>
  open: (url?: string, name?: string, features?: string) => FakePopup | null
  alert: (msg?: string) => void
  opener: unknown
  closed: boolean
  setTimeout: typeof setTimeout
  setInterval: typeof setInterval
  clearInterval: typeof clearInterval
  addEventListener: (type: string, cb: () => void) => void
  /** Fire a window event, so `pagehide` can be simulated. */
  fire: (type: string) => void
  opens: { url?: string; name?: string; features?: string }[]
  alerts: string[]
  [key: string]: unknown
}

function makePopup(): FakePopup {
  const popup: FakePopup = {
    closed: false,
    focusCount: 0,
    close(): void {
      popup.closed = true
    },
    focus(): void {
      popup.focusCount += 1
    }
  }
  return popup
}

/** A window that behaves enough like the real one for this module. */
function makeWindow(openResult: () => FakePopup | null): FakeWindow {
  const events = new Map<string, Set<() => void>>()
  const w: FakeWindow = {
    // A minimal editor api: the console namespace gets replaced by the
    // installer, and `device` stands in for everything a popup would borrow.
    api: { console: {}, device: { onData: () => () => undefined } },
    opens: [],
    alerts: [],
    opener: null,
    closed: false,
    open(url, name, features) {
      w.opens.push({ url, name, features })
      return openResult()
    },
    alert(msg) {
      w.alerts.push(String(msg ?? ''))
    },
    setTimeout: ((fn: () => void, ms?: number) =>
      globalThis.setTimeout(fn, ms)) as unknown as typeof setTimeout,
    setInterval: ((fn: () => void, ms?: number) =>
      globalThis.setInterval(fn, ms)) as unknown as typeof setInterval,
    clearInterval: ((id: number) => globalThis.clearInterval(id)) as unknown as typeof clearInterval,
    addEventListener(type, cb) {
      let set = events.get(type)
      if (!set) events.set(type, (set = new Set()))
      set.add(cb)
    },
    fire(type) {
      for (const cb of events.get(type) ?? []) cb()
    }
  }
  return w
}

/** Install the module against `w`, as the editor tab would. */
function installAgainst(w: FakeWindow): Record<string, (...args: never[]) => unknown> {
  ;(globalThis as { window?: unknown }).window = w
  installWebConsoleMain()
  return w.api.console as Record<string, (...args: never[]) => unknown>
}

const originalWindow = (globalThis as { window?: unknown }).window

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  ;(globalThis as { window?: unknown }).window = originalWindow
})

// ---------------------------------------------------------------------------
// The popup URL
// ---------------------------------------------------------------------------

describe('console popup identity', () => {
  it('opens a REAL page, so the service worker denylist can match it', () => {
    // The second half of #781's bug: the PWA answered every navigation with
    // index.html, opening the whole editor inside the popup. `console.html` is
    // on `navigateFallbackDenylist` in vite.web.config.ts, and this is the URL
    // that entry has to match.
    expect(consoleWindowUrl()).toBe('console.html')
  })

  it('uses one stable window name, so popping out twice re-adopts the window', () => {
    expect(CONSOLE_WINDOW_NAME).toBe('snakie-console')
  })
})

// ---------------------------------------------------------------------------
// The editor side — the lifecycle that was broken
// ---------------------------------------------------------------------------

describe('installWebConsoleMain — the editor side', () => {
  it('opens a real browser window at the console page', () => {
    const w = makeWindow(makePopup)
    const api = installAgainst(w)

    void api.open('prior output' as never)

    expect(w.opens).toHaveLength(1)
    expect(w.opens[0].url).toBe('console.html')
    expect(w.opens[0].name).toBe(CONSOLE_WINDOW_NAME)
    expect(w.opens[0].features).toContain('popup=yes')
  })

  it('hands the popup the scrollback it was opened with', async () => {
    const w = makeWindow(makePopup)
    const api = installAgainst(w)

    await api.open('>>> print(6*7)\r\n42\r\n' as never)

    await expect(api.requestSeed()).resolves.toBe('>>> print(6*7)\r\n42\r\n')
  })

  it('treats a missing seed as empty rather than undefined', async () => {
    const w = makeWindow(makePopup)
    const api = installAgainst(w)
    await api.open()
    await expect(api.requestSeed()).resolves.toBe('')
  })

  it('focuses the open window instead of stacking a second one', async () => {
    const popup = makePopup()
    const w = makeWindow(() => popup)
    const api = installAgainst(w)

    await api.open('a' as never)
    await api.open('b' as never)

    expect(w.opens).toHaveLength(1)
    expect(popup.focusCount).toBe(1)
    // The refreshed scrollback still takes effect.
    await expect(api.requestSeed()).resolves.toBe('b')
  })

  // --- every route back to the dock fires onClosed -------------------------

  it('fires onClosed when the editor closes the window (Redock)', async () => {
    const popup = makePopup()
    const w = makeWindow(() => popup)
    const api = installAgainst(w)
    let closed = 0
    api.onClosed((() => (closed += 1)) as never)

    await api.open('x' as never)
    api.close()

    // THE #810 regression test: without this event ShellPanel's `redock` never
    // clears `poppedOut`, and the console stays hidden behind its placeholder.
    expect(closed).toBe(1)
    expect(popup.closed).toBe(true)
  })

  it('fires onClosed when the pop-up is BLOCKED, so the console re-docks', async () => {
    const w = makeWindow(() => null)
    const api = installAgainst(w)
    let closed = 0
    api.onClosed((() => (closed += 1)) as never)

    await api.open('x' as never)

    expect(closed).toBe(1)
    expect(w.alerts).toHaveLength(1)
    expect(w.alerts[0]).toMatch(/blocked/i)
    // Nothing was left buffered for a window that never opened.
    await expect(api.requestSeed()).resolves.toBe('')
  })

  it('fires onClosed when the window is closed behind the editor’s back', async () => {
    const popup = makePopup()
    const w = makeWindow(() => popup)
    const api = installAgainst(w)
    let closed = 0
    api.onClosed((() => (closed += 1)) as never)

    await api.open('x' as never)
    // A crash, or a close that never fired `pagehide` — the sweeper is the
    // backstop, and without it the console would never come back.
    popup.closed = true
    vi.advanceTimersByTime(1200)

    expect(closed).toBe(1)
  })

  it('fires onClosed when the popup says goodbye and has really gone', async () => {
    const popup = makePopup()
    const w = makeWindow(() => popup)
    const api = installAgainst(w)
    let closed = 0
    api.onClosed((() => (closed += 1)) as never)

    await api.open('x' as never)
    const bridge = w[CONSOLE_BRIDGE_PROP] as ConsoleHostBridge
    popup.closed = true
    bridge.release()
    vi.advanceTimersByTime(300)

    expect(closed).toBe(1)
  })

  it('does NOT re-dock when the popup merely RELOADS', async () => {
    const popup = makePopup()
    const w = makeWindow(() => popup)
    const api = installAgainst(w)
    let closed = 0
    api.onClosed((() => (closed += 1)) as never)

    await api.open('x' as never)
    // `pagehide` fires for a reload too. The window is still open, so this must
    // not be read as a close — that would re-dock a perfectly good console.
    const bridge = w[CONSOLE_BRIDGE_PROP] as ConsoleHostBridge
    bridge.release()
    vi.advanceTimersByTime(300)

    expect(closed).toBe(0)
  })

  it('stops listening once an onClosed subscriber unsubscribes', async () => {
    const popup = makePopup()
    const w = makeWindow(() => popup)
    const api = installAgainst(w)
    let closed = 0
    const off = api.onClosed((() => (closed += 1)) as never) as unknown as () => void

    off()
    await api.open('x' as never)
    api.close()

    expect(closed).toBe(0)
  })

  it('one throwing listener does not stop the others being told', async () => {
    const w = makeWindow(makePopup)
    const api = installAgainst(w)
    let reached = 0
    api.onClosed((() => {
      throw new Error('boom')
    }) as never)
    api.onClosed((() => (reached += 1)) as never)

    await api.open('x' as never)
    expect(() => api.close()).not.toThrow()
    expect(reached).toBe(1)
  })

  it('closes an orphaned popup when the editor tab goes away', async () => {
    const popup = makePopup()
    const w = makeWindow(() => popup)
    const api = installAgainst(w)

    await api.open('x' as never)
    w.fire('pagehide')

    // Otherwise the popup lives on running against a dead realm.
    expect(popup.closed).toBe(true)
  })

  it('publishes a bridge the popup can find', async () => {
    const w = makeWindow(makePopup)
    const api = installAgainst(w)
    await api.open('seeded' as never)

    const bridge = w[CONSOLE_BRIDGE_PROP] as ConsoleHostBridge
    expect(bridge).toBeTruthy()
    expect(bridge.seed()).toBe('seeded')
    expect(bridge.api()).toBeTruthy()
  })

  it('lends the editor’s device through the bridge, not a copy of it', async () => {
    const w = makeWindow(makePopup)
    const api = installAgainst(w)
    await api.open('' as never)

    const bridge = w[CONSOLE_BRIDGE_PROP] as ConsoleHostBridge
    const lent = bridge.api() as { device: { onData: (cb: () => void) => () => void } }
    // The popup's terminal reads device.onData and writes device.sendData; both
    // must resolve to the EDITOR's, so there is exactly one board in play.
    expect(typeof lent.device.onData).toBe('function')
  })
})

// ---------------------------------------------------------------------------
// The popup side
// ---------------------------------------------------------------------------

describe('installWebConsoleWindow — the popup side', () => {
  it('reports no backend when there is no opener at all', () => {
    const w = makeWindow(makePopup)
    w.opener = null
    ;(globalThis as { window?: unknown }).window = w
    expect(installWebConsoleWindow()).toBe(false)
  })

  it('reports no backend when the opener is gone', () => {
    const w = makeWindow(makePopup)
    w.opener = { closed: true, [CONSOLE_BRIDGE_PROP]: {} }
    ;(globalThis as { window?: unknown }).window = w
    expect(installWebConsoleWindow()).toBe(false)
  })

  it('reports no backend for a hand-opened console.html (opener, no bridge)', () => {
    const w = makeWindow(makePopup)
    w.opener = { closed: false }
    ;(globalThis as { window?: unknown }).window = w
    expect(installWebConsoleWindow()).toBe(false)
  })

  it('adopts the editor’s api, and copies the seed into its own realm', async () => {
    const editorApi = { device: { onData: () => () => undefined }, console: {} }
    const bridge: ConsoleHostBridge = {
      seed: () => 'prior scrollback',
      api: () => editorApi,
      release: () => undefined
    }
    const w = makeWindow(makePopup)
    w.opener = { closed: false, [CONSOLE_BRIDGE_PROP]: bridge }
    ;(globalThis as { window?: unknown }).window = w

    expect(installWebConsoleWindow()).toBe(true)

    const api = w.api as { device: unknown; console: Record<string, () => unknown> }
    expect(api.device).toBe(editorApi.device)
    await expect(api.console.requestSeed()).resolves.toBe('prior scrollback')
  })

  it('never opens a window of its own, and its close() closes itself', async () => {
    const bridge: ConsoleHostBridge = {
      seed: () => '',
      api: () => ({ device: {} }),
      release: () => undefined
    }
    const w = makeWindow(makePopup)
    w.opener = { closed: false, [CONSOLE_BRIDGE_PROP]: bridge }
    let selfClosed = 0
    w.close = (): void => {
      selfClosed += 1
    }
    ;(globalThis as { window?: unknown }).window = w
    installWebConsoleWindow()

    const api = w.api as { console: Record<string, () => unknown> }
    await api.console.open()
    expect(w.opens).toHaveLength(0)

    api.console.close()
    expect(selfClosed).toBe(1)
  })

  it('tells the editor it is going, so the console re-docks', () => {
    let released = 0
    const bridge: ConsoleHostBridge = {
      seed: () => '',
      api: () => ({ device: {} }),
      release: () => {
        released += 1
      }
    }
    const w = makeWindow(makePopup)
    w.opener = { closed: false, [CONSOLE_BRIDGE_PROP]: bridge }
    ;(globalThis as { window?: unknown }).window = w
    installWebConsoleWindow()

    w.fire('pagehide')
    expect(released).toBe(1)
  })
})

describe('consoleHostAlive', () => {
  it('is false with no opener — the terminal would be a picture', () => {
    const w = makeWindow(makePopup)
    w.opener = null
    ;(globalThis as { window?: unknown }).window = w
    expect(consoleHostAlive()).toBe(false)
  })

  it('is false once the editor tab has closed', () => {
    const w = makeWindow(makePopup)
    w.opener = { closed: true, [CONSOLE_BRIDGE_PROP]: {} }
    ;(globalThis as { window?: unknown }).window = w
    expect(consoleHostAlive()).toBe(false)
  })

  it('is true while the editor tab is there with its bridge', () => {
    const w = makeWindow(makePopup)
    w.opener = { closed: false, [CONSOLE_BRIDGE_PROP]: {} }
    ;(globalThis as { window?: unknown }).window = w
    expect(consoleHostAlive()).toBe(true)
  })
})
