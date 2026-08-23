/**
 * WEB detached instrument windows — issue #781.
 * =============================================================================
 *
 * On the desktop, undocking an instrument opens a real OS `BrowserWindow`
 * (`src/main/instrumentWindows.ts`) whose renderer talks to the SAME Electron
 * main process, so the detached instrument reads the same device stream and
 * drives the same board as its docked twin.
 *
 * In the browser there is no main process, and `window.api.instruments.openWindow`
 * landed on the preload FALLBACK's `P(undefined)` stub — so undocking removed the
 * instrument from the dock and opened nothing at all. That is the bug.
 *
 * A browser popup is a separate JS realm, so it cannot simply build its own
 * backend: it would spin up a SECOND MicroPython simulator, and a Web Serial port
 * is exclusively locked by the context that opened it, so a real board could not
 * be shared at all. What a popup *can* do — because it is same-origin and opened
 * by us (never `noopener`) — is reach its opener directly. So the editor window
 * publishes a small BRIDGE on itself ({@link INSTRUMENT_BRIDGE_PROP}) and each
 * popup runs on the EDITOR's `window.api`: the same device, the same telemetry,
 * the same `sendControl`, one board.
 *
 *   openWindow(payload)   editor → popup   `window.open('instrument.html#key=…')`
 *   bridge.api(key)       popup → editor   the editor's api, subscription-tracked
 *   bridge.payload(key)   popup → editor   which instrument to render (on mount)
 *   bridge.onPayload      editor → popup   a refreshed payload for an open window
 *   bridge.release(key)   popup → editor   the popup is gone → drop subs + re-dock
 *
 * Everything the popup receives is created HERE, in the editor's realm, and every
 * subscription it makes is tracked, so when the popup goes away (its `pagehide`,
 * or the sweeper noticing `window.closed`) the editor drops the callbacks that
 * point into a dead realm. Without that, one closed popup would throw inside the
 * device layer's `dataSubs.forEach` and take the EDITOR's own telemetry with it.
 */
import type { InstrumentWindowPayload } from '../../../shared/instrument-window'

/** The property the editor window publishes its bridge on. Read by each popup
 *  through `window.opener` — same-origin, so this is a direct object reference,
 *  not a message channel. */
export const INSTRUMENT_BRIDGE_PROP = '__snakieInstrumentHost'

/** `window.open` features for an instrument popup — the desktop window's size
 *  (`instrumentWindows.ts`), as a real, user-resizable browser window. */
export const INSTRUMENT_WINDOW_FEATURES = 'popup=yes,width=460,height=430'

/** What the user is told when the browser refuses the popup. Names the cause and
 *  the fix — the instrument is re-docked either way, so nothing is lost. */
export const POPUP_BLOCKED_MESSAGE =
  'Snakie could not open the instrument in its own window — your browser blocked ' +
  'the pop-up. Allow pop-ups for this site and undock the instrument again. ' +
  '(It has been put back in the instrument dock for now.)'

/** The bridge an instrument popup uses to run on the EDITOR window's backend.
 *  Every member is defined in the editor's realm. */
export interface InstrumentHostBridge {
  /** The payload for `key` (which instrument to render), or `null` if the editor
   *  doesn't know this window — a stale/hand-typed `instrument.html`. */
  payload(key: string): InstrumentWindowPayload | null
  /** Subscribe to payload refreshes for `key`. Returns an unsubscribe. */
  onPayload(key: string, cb: (payload: InstrumentWindowPayload) => void): () => void
  /** The editor's `window.api` for this popup — subscription-tracked, so
   *  {@link release} can drop everything this window subscribed to. `null` when
   *  the editor has no such window open. */
  api(key: string): Record<string, unknown> | null
  /** This popup is going away (its `pagehide`). The editor confirms it really
   *  closed — a reload fires the same event — then drops its subscriptions and
   *  re-docks the instrument. */
  release(key: string): void
}

type AnyFn = (...args: unknown[]) => unknown
type Namespaces = Record<string, unknown>

/** A tracked, crash-tolerant view over another window's API object. */
export interface ApiGuard {
  /** Wrap `ns` (and, lazily, its nested namespaces). */
  view: <T extends object>(ns: T) => T
  /** Unsubscribe everything taken through {@link view} and refuse further calls. */
  dispose: () => void
}

/**
 * Wrap one window's API so ANOTHER window can call it safely.
 *
 * Two jobs, both of them about the borrowing window disappearing:
 *
 *  - **Callbacks are caught.** A subscriber handed over the boundary belongs to
 *    the popup's realm; once that realm is torn down, calling it throws. The
 *    device layer broadcasts with a bare `forEach`, so one such throw would stop
 *    the editor's OWN telemetry mid-broadcast. Every function argument is
 *    therefore wrapped before it is handed on.
 *  - **Unsubscribes are remembered.** Anything the API returns that is itself a
 *    function is an unsubscribe by this codebase's convention (`onX(cb) => off`),
 *    so it is recorded and {@link dispose} runs the lot.
 *
 * Pure: no DOM, no `window` — it only ever sees the objects it is given.
 */
export function createApiGuard(): ApiGuard {
  const offs = new Set<() => void>()
  const views = new WeakMap<object, object>()
  let live = true

  const safeCallback =
    (fn: AnyFn): AnyFn =>
    (...args: unknown[]): unknown => {
      try {
        return fn(...args)
      } catch {
        // The borrower's realm went away mid-broadcast. Swallowing it HERE is
        // what keeps this window's own subscribers running.
        return undefined
      }
    }

  const method =
    (target: object, fn: AnyFn): AnyFn =>
    (...args: unknown[]): unknown => {
      if (!live) return undefined
      const out = fn.apply(
        target,
        args.map((a) => (typeof a === 'function' ? safeCallback(a as AnyFn) : a))
      )
      if (typeof out !== 'function') return out
      const off = out as () => void
      offs.add(off)
      return (): void => {
        offs.delete(off)
        off()
      }
    }

  const view = <T extends object>(ns: T): T => {
    const cached = views.get(ns)
    if (cached) return cached as T
    const proxy = new Proxy(ns, {
      get(target, prop, receiver): unknown {
        const value = Reflect.get(target, prop, receiver) as unknown
        // A non-configurable, non-writable property must be reported verbatim or
        // the Proxy invariant throws — cheap insurance against a frozen API.
        const desc = Object.getOwnPropertyDescriptor(target, prop)
        if (desc && !desc.configurable && !desc.writable) return value
        if (typeof value === 'function') return method(target, value as AnyFn)
        if (typeof value === 'object' && value !== null) return view(value as object)
        return value
      }
    })
    views.set(ns, proxy)
    return proxy as T
  }

  return {
    view,
    dispose(): void {
      live = false
      for (const off of [...offs]) {
        try {
          off()
        } catch {
          // Already gone — nothing left to unsubscribe from.
        }
      }
      offs.clear()
    }
  }
}

/**
 * The popup URL for one instrument. The key travels in the FRAGMENT, not the
 * query string: a fragment is not part of the request URL, so the offline
 * service worker still matches its precached `instrument.html`. With `?key=…`
 * the precache lookup missed and the PWA's navigation fallback answered with
 * `index.html` — i.e. the whole editor, opened inside the instrument window.
 */
export function instrumentWindowUrl(key: string): string {
  return `instrument.html#key=${encodeURIComponent(key)}`
}

/** A stable `window.open` name per instrument, so re-undocking the same
 *  instrument re-adopts its window instead of stacking a second one. */
export function instrumentWindowName(key: string): string {
  return `snakie-instrument-${key.replace(/[^a-zA-Z0-9]+/g, '-')}`
}

/** The instrument key from a popup's `location.hash`, or `null` if absent (a
 *  hand-opened `instrument.html` has nothing to render). */
export function instrumentKeyFromHash(hash: string): string | null {
  const key = new URLSearchParams(hash.replace(/^#/, '')).get('key')
  return key && key.length > 0 ? key : null
}

/** How often the editor checks whether a popup was closed behind its back (a
 *  crash, or a close that never fired `pagehide`). */
const SWEEP_MS = 1000

/** How long after a popup says goodbye the editor waits before believing it —
 *  long enough for `window.closed` to have flipped on a real close. */
const CLOSE_CONFIRM_MS = 150

interface PopupRecord {
  window: Window
  guard: ApiGuard | null
}

/**
 * Install the EDITOR side: `instruments.openWindow` / `closeWindow` /
 * `onWindowClosed` open and track real browser windows, and the bridge each
 * popup runs on is published on this window. Called from {@link installWebApi}.
 */
export function installWebInstrumentsMain(): void {
  const w = window as typeof window & { api?: Namespaces; [INSTRUMENT_BRIDGE_PROP]?: unknown }
  if (!w.api) return

  /** Latest payload per key, buffered so a freshly-opened popup can pull it on
   *  mount (the same open-time race `instrumentWindows.ts` buffers for). */
  const payloads = new Map<string, InstrumentWindowPayload>()
  const popups = new Map<string, PopupRecord>()
  const payloadSubs = new Map<string, Set<(p: InstrumentWindowPayload) => void>>()
  const closedListeners = new Set<(e: { key: string }) => void>()
  let sweeper = 0

  const fireClosed = (key: string): void => {
    for (const cb of [...closedListeners]) cb({ key })
  }

  /** Forget a popup: drop the subscriptions it took, then tell the editor to
   *  re-dock the instrument (exactly what the desktop's `closed` handler does). */
  const forget = (key: string): void => {
    const rec = popups.get(key)
    if (!rec) return
    popups.delete(key)
    rec.guard?.dispose()
    payloads.delete(key)
    payloadSubs.delete(key)
    if (popups.size === 0 && sweeper) {
      window.clearInterval(sweeper)
      sweeper = 0
    }
    fireClosed(key)
  }

  // A popup closed with its ✕ says goodbye on `pagehide`; this catches the cases
  // that don't (a crashed window, a browser that skipped the event).
  const startSweeper = (): void => {
    if (sweeper) return
    sweeper = window.setInterval(() => {
      for (const [key, rec] of [...popups]) if (rec.window.closed) forget(key)
    }, SWEEP_MS)
  }

  const bridge: InstrumentHostBridge = {
    payload: (key) => payloads.get(key) ?? null,
    onPayload: (key, cb) => {
      let set = payloadSubs.get(key)
      if (!set) payloadSubs.set(key, (set = new Set()))
      set.add(cb)
      return () => set.delete(cb)
    },
    api: (key) => {
      const rec = popups.get(key)
      if (!rec || !w.api) return null
      // The window (re)started: its previous subscriptions belong to a realm that
      // is already gone, so they go with it.
      rec.guard?.dispose()
      rec.guard = createApiGuard()
      payloadSubs.delete(key)
      return rec.guard.view(w.api)
    },
    // `pagehide` fires for a RELOAD as well as a close, and the two must not be
    // confused — releasing a reloading window would re-dock a perfectly good
    // instrument. `closed` tells them apart, but only once the window has
    // actually gone, so look a moment later (and the sweeper backs this up).
    release: (key) => {
      window.setTimeout(() => {
        const rec = popups.get(key)
        if (rec && rec.window.closed) forget(key)
      }, CLOSE_CONFIRM_MS)
    }
  }
  w[INSTRUMENT_BRIDGE_PROP] = bridge

  const instruments = (w.api.instruments ?? {}) as Namespaces
  Object.assign(instruments, {
    openWindow: async (payload: InstrumentWindowPayload): Promise<void> => {
      payloads.set(payload.key, payload)
      const open = popups.get(payload.key)
      if (open && !open.window.closed) {
        // Already out: refresh what it renders and bring it forward.
        for (const cb of payloadSubs.get(payload.key) ?? []) {
          try {
            cb(payload)
          } catch {
            // That window went between the check and the call — the sweeper
            // will notice; the others still get their refresh.
          }
        }
        open.window.focus()
        return
      }
      const popup = window.open(
        instrumentWindowUrl(payload.key),
        instrumentWindowName(payload.key),
        INSTRUMENT_WINDOW_FEATURES
      )
      if (!popup) {
        // Blocked. Put the instrument back in the dock and say why, rather than
        // leaving the user with an instrument that vanished.
        payloads.delete(payload.key)
        fireClosed(payload.key)
        window.alert(POPUP_BLOCKED_MESSAGE)
        return
      }
      popups.set(payload.key, { window: popup, guard: null })
      startSweeper()
    },
    closeWindow: (key: string): void => {
      const rec = popups.get(key)
      forget(key)
      if (rec && !rec.window.closed) rec.window.close()
    },
    onWindowClosed: (cb: (e: { key: string }) => void): (() => void) => {
      closedListeners.add(cb)
      return () => closedListeners.delete(cb)
    }
  })
  w.api.instruments = instruments as unknown as Window['api']['instruments']

  // Reloading or closing the editor would otherwise leave orphaned popups running
  // on a dead realm — the desktop closes its instrument windows on unmount, so do
  // the same here.
  window.addEventListener('pagehide', () => {
    for (const rec of popups.values()) {
      try {
        rec.window.close()
      } catch {
        // Already gone.
      }
    }
  })
}

/**
 * Install the POPUP side (`instrument-window-main.tsx`): run on the editor's
 * `window.api` so this instrument sees the same device, and answer the window
 * payload / dock controls from the bridge.
 *
 * Returns `false` when there is no reachable editor window — the caller renders
 * the "disconnected" state rather than a window that looks alive and isn't.
 */
export function installWebInstrumentWindow(key: string | null): boolean {
  const w = window as typeof window & { api?: Namespaces }
  if (!w.api || !key) return false

  let bridge: InstrumentHostBridge | undefined
  try {
    const opener = window.opener as (Window & { [INSTRUMENT_BRIDGE_PROP]?: unknown }) | null
    if (opener && !opener.closed) {
      bridge = opener[INSTRUMENT_BRIDGE_PROP] as InstrumentHostBridge | undefined
    }
  } catch {
    // The opener navigated somewhere we may not touch — treat it as gone.
  }
  const hostApi = bridge?.api(key)
  if (!bridge || !hostApi) return false
  const host = bridge

  const instruments = {
    ...((hostApi.instruments ?? {}) as Namespaces),
    // A popup renders exactly one instrument and never opens another window.
    openWindow: async (): Promise<void> => undefined,
    closeWindow: (): void => window.close(),
    // Copy the payload into THIS realm: it must outlive the editor window's
    // objects if that window ever goes away mid-session.
    requestWindowPayload: async (): Promise<InstrumentWindowPayload | null> => {
      const p = host.payload(key)
      return p ? (structuredClone(p) as InstrumentWindowPayload) : null
    },
    onWindowPayload: (cb: (p: InstrumentWindowPayload) => void): (() => void) =>
      host.onPayload(key, (p) => cb(structuredClone(p) as InstrumentWindowPayload))
  }
  w.api = { ...hostApi, instruments } as unknown as typeof w.api

  window.addEventListener('pagehide', () => {
    try {
      host.release(key)
    } catch {
      // The editor went first — nothing to release.
    }
  })
  return true
}

/** Is this popup's editor window still there? The instrument runs on the
 *  editor's backend, so once that window is gone the instrument is a picture. */
export function instrumentHostAlive(): boolean {
  try {
    const opener = window.opener as (Window & { [INSTRUMENT_BRIDGE_PROP]?: unknown }) | null
    return !!opener && !opener.closed && !!opener[INSTRUMENT_BRIDGE_PROP]
  } catch {
    return false
  }
}
