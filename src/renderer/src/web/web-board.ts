/**
 * WEB Board View window — epic #267.
 * =============================================================================
 *
 * On the desktop the Board View is a separate Electron `BrowserWindow` and the
 * main process relays messages between it and the editor window
 * (`src/main/board.ts`). On the web the same `board.html` bundle opens as a
 * plain browser popup (`window.open`), and this module replaces the Electron
 * IPC relay with a same-origin `BroadcastChannel`:
 *
 *   source      main → board   the streamed {source,fileName,…} payload
 *   request     board → main   pull the buffered payload on mount
 *   close       main → board   close the popup (toolbar toggle)
 *   opened      board → main   the popup mounted (flips the toolbar state)
 *   closed      board → main   the popup closed (pagehide)
 *   select      either → other the chosen board id (mini board ↔ full viewer)
 *   instruments board → main   launch a scope/meter in the MAIN window
 *   robot       either → other robot.yml changed (reload project parts/wiring)
 *
 * The channel never echoes to its sender, which is exactly the Electron relay's
 * "notify every OTHER window" semantics — no self-feedback loops.
 *
 * Storage is shared per-origin (localStorage theme, IndexedDB folder handle,
 * the localStorage robot.yml fallback), so the popup sees the same project. A
 * folder picked via the File System Access API re-grants silently within the
 * same browser session; a popup opened in a FRESH session may not get read
 * access until the main window re-opens the folder (#476's pending-handle flow).
 */
import type { BoardSourcePayload, InstrumentOpenPayload } from '../../../preload/index.d'

const CHANNEL = 'snakie.board.v1'

/** Wire shape on the BroadcastChannel — a tagged union per relay message. */
type BoardMessage =
  | { t: 'source'; payload: BoardSourcePayload }
  | { t: 'request' }
  | { t: 'close' }
  | { t: 'opened' }
  | { t: 'closed' }
  | { t: 'select'; id: string }
  | { t: 'instruments'; payload: InstrumentOpenPayload }
  | { t: 'robot' }

type Listener<T> = (value: T) => void

/** One shared channel + tiny pub/sub per message tag. */
function makeBus(): {
  post: (m: BoardMessage) => void
  on: <T extends BoardMessage['t']>(
    tag: T,
    cb: Listener<Extract<BoardMessage, { t: T }>>
  ) => () => void
} {
  const channel = new BroadcastChannel(CHANNEL)
  const listeners = new Map<string, Set<Listener<never>>>()
  channel.onmessage = (e: MessageEvent<BoardMessage>) => {
    const set = listeners.get(e.data?.t)
    if (set) for (const cb of [...set]) (cb as Listener<BoardMessage>)(e.data)
  }
  return {
    post: (m) => channel.postMessage(m),
    on: (tag, cb) => {
      let set = listeners.get(tag)
      if (!set) listeners.set(tag, (set = new Set()))
      set.add(cb as Listener<never>)
      return () => set.delete(cb as Listener<never>)
    }
  }
}

/** Wrap `robot.save` to broadcast a change to the other window, and `onChanged`
 *  to receive it — the web twin of Electron's `robot:didChange` relay (which
 *  also only ever notified windows OTHER than the saver). Both windows call
 *  this, so a part placed in the popup reloads the main window's mini board,
 *  and vice versa. */
function bridgeRobotChanges(bus: ReturnType<typeof makeBus>): void {
  const w = window as typeof window & { api?: Record<string, unknown> }
  const robot = w.api?.robot as
    | { save?: (...args: unknown[]) => Promise<unknown>; onChanged?: (cb: () => void) => () => void }
    | undefined
  if (!robot?.save) return
  const save = robot.save.bind(robot)
  robot.save = async (...args: unknown[]): Promise<unknown> => {
    const result = await save(...args)
    bus.post({ t: 'robot' })
    return result
  }
  robot.onChanged = (cb: () => void): (() => void) => bus.on('robot', () => cb())
}

/**
 * Install the MAIN-window side over the fallback stubs: `board.open()` pops
 * `board.html` out as a browser window and the rest of the namespace talks to
 * it over the channel. Called from {@link installWebApi} in the main entry.
 */
export function installWebBoardMain(): void {
  const w = window as typeof window & { api?: Record<string, unknown> }
  if (!w.api) return
  const bus = makeBus()

  let popup: Window | null = null
  /** Buffered latest payload so a freshly-opened popup can pull it on mount
   *  (same open-time race as the desktop's `board:requestSource`). */
  let lastPayload: BoardSourcePayload | null = null

  const openedListeners = new Set<() => void>()
  const closedListeners = new Set<() => void>()
  const emit = (set: Set<() => void>): void => {
    for (const cb of [...set]) cb()
  }

  bus.on('request', () => {
    if (lastPayload) bus.post({ t: 'source', payload: lastPayload })
  })
  bus.on('opened', () => emit(openedListeners))
  bus.on('closed', () => {
    popup = null
    emit(closedListeners)
  })

  const board = (w.api.board ?? {}) as Record<string, unknown>
  board.open = async (): Promise<void> => {
    if (popup && !popup.closed) {
      popup.focus()
      emit(openedListeners)
      return
    }
    // Named window: if the user still has an orphaned board window (e.g. after
    // an editor reload), this re-adopts it instead of stacking a second one.
    popup = window.open('board.html', 'snakie-board', 'popup=yes,width=980,height=720')
    if (!popup) {
      // Popup blocked — reset the toolbar's "open" state and surface the error.
      emit(closedListeners)
      throw new Error('The browser blocked the Board View popup.')
    }
    emit(openedListeners)
  }
  board.close = (): void => {
    // Broadcast too: after an editor reload the handle is stale, but an
    // orphaned popup still hears the channel and closes itself.
    bus.post({ t: 'close' })
    if (popup && !popup.closed) popup.close() // its pagehide broadcasts 'closed'
    else emit(closedListeners) // stale handle — still reset the toolbar state
    popup = null
  }
  board.update = (payload: BoardSourcePayload): void => {
    lastPayload = payload
    bus.post({ t: 'source', payload })
  }
  board.requestSource = async (): Promise<BoardSourcePayload | null> => lastPayload
  board.onOpened = (cb: () => void): (() => void) => {
    openedListeners.add(cb)
    return () => openedListeners.delete(cb)
  }
  board.onClosed = (cb: () => void): (() => void) => {
    closedListeners.add(cb)
    return () => closedListeners.delete(cb)
  }
  board.selectBoard = (id: string): void => bus.post({ t: 'select', id })
  board.onSelectBoard = (cb: (id: string) => void): (() => void) =>
    bus.on('select', (m) => cb(m.id))
  w.api.board = board as unknown as Window['api']['board']

  // A scope/meter launched from a board node in the POPUP renders in the MAIN
  // window's instrument dock (desktop parity: the `instruments:open` relay).
  const instruments = (w.api.instruments ?? {}) as Record<string, unknown>
  instruments.onOpen = (cb: (payload: InstrumentOpenPayload) => void): (() => void) =>
    bus.on('instruments', (m) => cb(m.payload))
  w.api.instruments = instruments as unknown as Window['api']['instruments']

  bridgeRobotChanges(bus)
}

/**
 * Install the BOARD-window side (the popup itself, `board-main.tsx`): receive
 * the streamed payload, pull the buffered one on mount, and relay instrument
 * launches / board selections back. Announces `opened`/`closed` so the main
 * window's toolbar toggle tracks the popup's real lifecycle.
 */
export function installWebBoardWindow(): void {
  const w = window as typeof window & { api?: Record<string, unknown> }
  if (!w.api) return
  const bus = makeBus()

  bus.on('close', () => window.close())
  window.addEventListener('pagehide', () => bus.post({ t: 'closed' }))

  const board = (w.api.board ?? {}) as Record<string, unknown>
  board.close = (): void => window.close()
  board.onSource = (cb: (payload: BoardSourcePayload) => void): (() => void) =>
    bus.on('source', (m) => cb(m.payload))
  board.requestSource = async (): Promise<BoardSourcePayload | null> => {
    // Fire-and-forget pull: the main window answers with a 'source' broadcast,
    // which lands via `onSource` above (there is no request/response pairing).
    bus.post({ t: 'request' })
    return null
  }
  board.selectBoard = (id: string): void => bus.post({ t: 'select', id })
  board.onSelectBoard = (cb: (id: string) => void): (() => void) =>
    bus.on('select', (m) => cb(m.id))
  w.api.board = board as unknown as Window['api']['board']

  const instruments = (w.api.instruments ?? {}) as Record<string, unknown>
  instruments.open = (payload: InstrumentOpenPayload): void =>
    bus.post({ t: 'instruments', payload })
  w.api.instruments = instruments as unknown as Window['api']['instruments']

  bridgeRobotChanges(bus)

  // Announce AFTER the handlers exist so the main window's reply can land.
  bus.post({ t: 'opened' })
}
