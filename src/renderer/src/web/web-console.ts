/**
 * WEB detached CONSOLE window — issue #810.
 * =============================================================================
 *
 * The sibling of `web-instruments.ts` (#781), and the same bug in the same
 * shape. On the desktop, popping the console out opens a real OS `BrowserWindow`
 * (`src/main/consoleWindow.ts`) that the main process relays the device stream
 * to. In the browser `window.api.console.open` landed on the preload FALLBACK's
 * stub, so the pop-out button did nothing.
 *
 * It was worse than a dead button, because `ShellPanel` sets `poppedOut` BEFORE
 * it calls `open`: the docked terminal was hidden behind a "Console popped out
 * to its own window" placeholder, no window appeared, and **Redock was dead
 * too** — it calls `console.close()` (a `noop` stub) and waits for the
 * `console:closed` event to clear the flag, but `onClosed` was the `unsub` stub,
 * so that event could never arrive. The console stayed hidden for the rest of
 * the session unless the panel happened to remount.
 *
 * ── The same bridge, for one window ─────────────────────────────────────────
 * A popup is a separate JS realm, so it cannot build its own backend: it would
 * spin up a SECOND MicroPython simulator, and a Web Serial port is exclusively
 * locked by the context that opened it. So — exactly as for instruments — the
 * editor tab publishes a bridge on itself and the popup runs on the EDITOR's
 * `window.api`. `Terminal` reads `device.onData` and writes `device.sendData`,
 * so a popped-out console is fully interactive against the same board.
 *
 *   open(seed)     editor → popup   `window.open('console.html')`
 *   bridge.api()   popup → editor   the editor's api, subscription-tracked
 *   bridge.seed()  popup → editor   the scrollback to redraw on mount
 *   bridge.release popup → editor   the popup is gone → drop subs + re-dock
 *
 * The guard ({@link createApiGuard}, reused from `web-instruments.ts` rather
 * than copied) is the load-bearing part for the same reason it was there: the
 * device layer broadcasts with a bare `forEach`, so one dead popup callback
 * would throw mid-broadcast and take the EDITOR's own console with it.
 *
 * ── Why this one is simpler ─────────────────────────────────────────────────
 * There is exactly ONE console, so nothing here is keyed. `consoleWindow.ts`
 * keeps a single window on the desktop and this mirrors that: opening while
 * already open focuses the existing window instead of stacking a second.
 */
import { createApiGuard, type ApiGuard } from './web-instruments'

type Namespaces = Record<string, unknown>

/** Where the editor tab publishes its bridge so the popup can find it through
 *  `window.opener` — same-origin, so this is a direct object reference. */
export const CONSOLE_BRIDGE_PROP = '__snakieConsoleHost'

/** Roughly the desktop console window's proportions (`consoleWindow.ts`) — a
 *  terminal needs width for 80 columns far more than it needs height. */
export const CONSOLE_WINDOW_FEATURES = 'popup=yes,width=760,height=440'

/** One window, so one stable name: popping out twice re-adopts the window
 *  rather than stacking a second one. */
export const CONSOLE_WINDOW_NAME = 'snakie-console'

/** Said when the browser blocks the popup. The console is re-docked either way,
 *  so nothing is lost — but silence would look like the old bug. */
export const CONSOLE_POPUP_BLOCKED_MESSAGE =
  'Your browser blocked the console pop-up window. The console has been put back in the ' +
  'panel. Allow pop-ups for this site if you would like it in its own window.'

/** The editor-side bridge a console popup runs against. Every member is defined
 *  in the EDITOR's realm. */
export interface ConsoleHostBridge {
  /** The scrollback to redraw on mount, so the popup does not start blank. */
  seed: () => string
  /** The editor's `window.api`, subscription-tracked for this popup. */
  api: () => Namespaces | null
  /** The popup is going away — drop its subscriptions and re-dock. */
  release: () => void
}

/**
 * The popup URL. Unlike an instrument this carries no key, but it is still a
 * REAL page rather than the app shell: `console.html` has to be in the web
 * build's inputs and on the service worker's `navigateFallbackDenylist`, or the
 * PWA answers its navigation with `index.html` and opens the whole editor
 * inside a 760px window (the second half of #781's bug).
 */
export function consoleWindowUrl(): string {
  return 'console.html'
}

/** How often the editor checks whether the popup was closed behind its back (a
 *  crash, or a close that never fired `pagehide`). */
const SWEEP_MS = 1000

/** How long after the popup says goodbye the editor waits before believing it —
 *  long enough for `window.closed` to have flipped on a real close. */
const CLOSE_CONFIRM_MS = 150

/**
 * Install the EDITOR side: `console.open` / `close` / `onClosed` /
 * `requestSeed` drive a real browser window, and the bridge the popup runs on
 * is published on this window. Called from `installWebApi`.
 */
export function installWebConsoleMain(): void {
  const w = window as typeof window & { api?: Namespaces; [CONSOLE_BRIDGE_PROP]?: unknown }
  if (!w.api) return

  let popup: Window | null = null
  let guard: ApiGuard | null = null
  /** The scrollback handed over at open time, buffered for the popup to pull on
   *  mount (the same open-time race `consoleWindow.ts` buffers for). */
  let seed = ''
  const closedListeners = new Set<() => void>()
  let sweeper = 0

  /** Forget the popup: drop the subscriptions it took, then tell the editor to
   *  re-dock — exactly what the desktop's `closed` handler does. */
  const forget = (): void => {
    if (!popup) return
    popup = null
    guard?.dispose()
    guard = null
    seed = ''
    if (sweeper) {
      window.clearInterval(sweeper)
      sweeper = 0
    }
    // This is the event ShellPanel's `redock` waits on. Without it the panel
    // stays stuck behind its placeholder — the actual #810 symptom.
    for (const cb of [...closedListeners]) {
      try {
        cb()
      } catch {
        // One bad listener must not stop the others being told.
      }
    }
  }

  const startSweeper = (): void => {
    if (sweeper) return
    sweeper = window.setInterval(() => {
      if (popup?.closed) forget()
    }, SWEEP_MS)
  }

  const bridge: ConsoleHostBridge = {
    seed: () => seed,
    api: () => {
      if (!popup || !w.api) return null
      // The window (re)started: its previous subscriptions belong to a realm
      // that is already gone, so they go with it.
      guard?.dispose()
      guard = createApiGuard()
      return guard.view(w.api)
    },
    // `pagehide` fires for a RELOAD as well as a close, and confusing the two
    // would re-dock a perfectly good console. `closed` tells them apart, but
    // only once the window has actually gone — so look a moment later.
    release: () => {
      window.setTimeout(() => {
        if (popup?.closed) forget()
      }, CLOSE_CONFIRM_MS)
    }
  }
  w[CONSOLE_BRIDGE_PROP] = bridge

  const consoleNs = (w.api.console ?? {}) as Namespaces
  Object.assign(consoleNs, {
    open: async (nextSeed?: string): Promise<void> => {
      seed = nextSeed ?? ''
      if (popup && !popup.closed) {
        popup.focus()
        return
      }
      const opened = window.open(consoleWindowUrl(), CONSOLE_WINDOW_NAME, CONSOLE_WINDOW_FEATURES)
      if (!opened) {
        // Blocked. Put the console back in the dock and say why, rather than
        // leaving the user behind a placeholder with no window and no way back.
        seed = ''
        for (const cb of [...closedListeners]) {
          try {
            cb()
          } catch {
            // As above.
          }
        }
        window.alert(CONSOLE_POPUP_BLOCKED_MESSAGE)
        return
      }
      popup = opened
      startSweeper()
    },
    close: (): void => {
      const open = popup
      forget()
      if (open && !open.closed) open.close()
    },
    requestSeed: async (): Promise<string> => seed,
    onClosed: (cb: () => void): (() => void) => {
      closedListeners.add(cb)
      return () => closedListeners.delete(cb)
    }
  })
  w.api.console = consoleNs as unknown as Window['api']['console']

  // Reloading or closing the editor would otherwise leave an orphaned popup
  // running on a dead realm — the desktop closes its console window on quit.
  window.addEventListener('pagehide', () => {
    try {
      popup?.close()
    } catch {
      // Already gone.
    }
  })
}

/**
 * Install the POPUP side (`console-window-main.tsx`): run on the editor's
 * `window.api` so this console reads and writes the same board.
 *
 * Returns `false` when there is no reachable editor window — the caller renders
 * the "disconnected" state rather than a terminal that looks live and is not.
 */
export function installWebConsoleWindow(): boolean {
  const w = window as typeof window & { api?: Namespaces }
  if (!w.api) return false

  let bridge: ConsoleHostBridge | undefined
  try {
    const opener = window.opener as (Window & { [CONSOLE_BRIDGE_PROP]?: unknown }) | null
    if (opener && !opener.closed) {
      bridge = opener[CONSOLE_BRIDGE_PROP] as ConsoleHostBridge | undefined
    }
  } catch {
    // The opener navigated somewhere we may not touch — treat it as gone.
  }
  const hostApi = bridge?.api()
  if (!bridge || !hostApi) return false
  const host = bridge

  const consoleNs = {
    ...((hostApi.console ?? {}) as Namespaces),
    // A popup IS the console window; it never opens another.
    open: async (): Promise<void> => undefined,
    close: (): void => window.close(),
    // `String(...)` copies the scrollback into THIS realm, so it outlives the
    // editor window's objects if that window ever goes away mid-session.
    requestSeed: async (): Promise<string> => String(host.seed() ?? ''),
    onClosed: (): (() => void) => () => undefined
  }
  w.api = { ...hostApi, console: consoleNs } as unknown as typeof w.api

  window.addEventListener('pagehide', () => {
    try {
      host.release()
    } catch {
      // The editor went first — nothing to release.
    }
  })
  return true
}

/** Is this popup's editor window still there? The console reads the board
 *  through that tab, so once it is gone the terminal is a picture. */
export function consoleHostAlive(): boolean {
  try {
    const opener = window.opener as (Window & { [CONSOLE_BRIDGE_PROP]?: unknown }) | null
    return !!opener && !opener.closed && !!opener[CONSOLE_BRIDGE_PROP]
  } catch {
    return false
  }
}
