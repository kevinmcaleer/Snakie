/**
 * Preload-bridge fallback.
 *
 * In Electron, `window.api` / `window.electron` are injected by the preload
 * script. Outside Electron — a plain browser (the web build, epic #267), or if the
 * preload ever fails to load — they are `undefined`, and any component that
 * touches them on mount (e.g. the Toolbar via `useDeviceStatus`) would throw and
 * crash the whole renderer to a blank screen.
 *
 * This installs a no-op fallback that returns "disconnected / empty" defaults so
 * the UI still renders and degrades gracefully. It is imported for its side effect
 * from `main.tsx` BEFORE React renders. In real Electron the bridge is already
 * present, so this is a safety net only (and logs a warning if used).
 *
 * The explicit map below gives correct SHAPES for the methods the UI reads on
 * mount (so `.map`/destructuring don't blow up). Everything is then wrapped in a
 * self-healing Proxy ({@link fill}) so that ANY namespace or method the map misses
 * — including ones added to the `Api` later — still returns a safe no-op instead
 * of throwing. That keeps the browser build rendering as the API grows, without
 * having to mirror every method here by hand.
 */
const noop = (): void => {}
const unsub = (): (() => void) => noop
const P =
  <T>(value: T) =>
  (): Promise<T> =>
    Promise.resolve(value)

/**
 * A stub that is safe to (a) CALL → resolves to an empty array (also fine to
 * destructure / read a missing key off), (b) index DEEPER → another stub, and
 * (c) use as a SUBSCRIPTION (`onX`) → returns an unsubscribe. So any
 * `window.api.<ns>.<method>(...)` the explicit map doesn't cover is inert, not a
 * crash. `[]` is the universal empty: `.map`/`.forEach`/`.length` all work, and
 * `const { ok } = await x()` just yields `undefined`.
 */
const deepStub = (): unknown => {
  const target = (): Promise<unknown> => Promise.resolve([])
  return new Proxy(target, {
    get: (_t, prop) => {
      const name = typeof prop === 'string' ? prop : ''
      if (name === 'then') return undefined // not thenable — awaiting a namespace won't hang
      if (name.startsWith('on')) return unsub // a subscription → an unsubscribe
      return deepStub()
    },
    apply: () => Promise.resolve([])
  })
}

/** Wrap an explicit stub namespace so any MISSING property is filled by {@link deepStub}. */
const fill = (target: Record<string, unknown>): unknown =>
  new Proxy(target, {
    get: (t, prop) => {
      if (prop in t) {
        const v = t[prop as string]
        // Recurse into nested namespace OBJECTS so their missing methods fill too.
        return v && typeof v === 'object' && !Array.isArray(v) && typeof v !== 'function'
          ? fill(v as Record<string, unknown>)
          : v
      }
      const name = typeof prop === 'string' ? prop : ''
      if (name === 'then') return undefined
      if (name.startsWith('on')) return unsub
      return deepStub()
    }
  })

// Read through a widened type so TS doesn't treat the (declared non-optional)
// globals as always-present — outside Electron they genuinely are not.
const w = window as typeof window & {
  api?: Window['api']
  electron?: Window['electron']
}

if (!w.api) {
  // Inside Electron a missing bridge means the preload FAILED to load (a real
  // bug) — log loudly so it isn't silently masked. In a plain browser it's
  // expected (no preload), so a warning suffices. Either way we install the
  // no-op stub to keep the UI from blank-screening.
  const inElectron = typeof navigator !== 'undefined' && /electron/i.test(navigator.userAgent)
  const log = inElectron ? console.error : console.warn
  log(
    `[Snakie] window.api is missing — installing a no-op fallback. Device, file, ` +
      `firmware, LLM, package and Git features are inert. ` +
      (inElectron
        ? 'Running in Electron, so the PRELOAD FAILED TO LOAD — check the preload path / sandbox setting.'
        : 'Not running inside Electron (e.g. the web build / a browser preview).')
  )

  const api = {
    // Top-level app methods (the Proxy net covers any not listed).
    ping: P(''),
    appVersion: P(''),
    openExternal: P(undefined),
    versions: {},
    device: {
      listPorts: P([]),
      connect: P(undefined),
      disconnect: P(undefined),
      getStatus: P({ state: 'disconnected' }),
      exec: P({ stdout: '', stderr: '' }),
      eval: P(''),
      interrupt: P(undefined),
      softReset: P(undefined),
      sendData: P(undefined),
      listDir: P([]),
      readFile: P(''),
      writeFile: P(undefined),
      remove: P(undefined),
      mkdir: P(undefined),
      rename: P(undefined),
      stat: P({ isDir: false, size: 0 }),
      onData: unsub,
      onStatus: unsub
    },
    fs: {
      openFolderDialog: P(null),
      openFileDialog: P(null),
      readDir: P([]),
      readFile: P(''),
      writeFile: P(undefined),
      mkdir: P(undefined),
      rename: P(undefined),
      remove: P(undefined),
      stat: P({ isDir: false, size: 0, mtimeMs: 0 })
    },
    firmware: {
      detectBoards: P([]),
      checkEsptool: P({ installed: false, version: null }),
      pickFirmwareFile: P(null),
      flash: P({ ok: false, log: '' }),
      onProgress: unsub
    },
    llm: {
      listProviders: P([]),
      getKeyStatus: P({ hasKey: false, secure: false }),
      setKey: P(undefined),
      saveKey: P(undefined),
      sendMessage: P(''),
      onStream: unsub
    },
    packages: {
      topPackages: P([]),
      search: P([]),
      install: P({ name: '', ok: false, log: '', notes: [] })
    },
    modules: {
      catalog: P([]),
      installPlan: P({ id: '', importName: '', mechanism: 'mip', notes: [] }),
      install: P({ id: '', ok: false, log: '', notes: [] }),
      probeInstalled: P([]),
      notifyChanged: noop,
      onChanged: unsub
    },
    updates: {
      check: P(undefined),
      quitAndInstall: P(undefined),
      onStatus: unsub
    },
    robot: {
      load: P({ parts: [], connections: [] }),
      // ok:false so a genuinely-stubbed save shows "save failed" instead of a
      // false "saved ✓" while writing nothing (the web build installs a real
      // backend over this; see web/web-robot.ts).
      save: P({ ok: false, error: 'Saving robot.yml is not available here.' }),
      importMesh: P({ cancelled: true }),
      importPartMesh: P({}),
      onChanged: unsub
    },
    board: {
      open: P(undefined),
      close: noop,
      update: noop,
      requestSource: P(null),
      onSource: unsub,
      onClosed: unsub,
      onOpened: unsub,
      selectBoard: noop,
      onSelectBoard: unsub,
      listUserBoards: P([]),
      openBoardsFolder: P(undefined),
      saveUserBoard: P({ ok: true }),
      deleteUserBoard: P(undefined)
    },
    instruments: {
      open: noop,
      onOpen: unsub,
      librarySource: P(''),
      umbrellaSource: P(''),
      openWindow: P(undefined),
      closeWindow: noop,
      requestWindowPayload: P(null),
      onWindowPayload: unsub,
      onWindowClosed: unsub
    },
    console: {
      open: P(undefined),
      requestSeed: P(''),
      close: noop,
      onClosed: unsub
    },
    find: {
      open: P(undefined),
      close: noop,
      sendCommand: noop,
      onCommand: unsub,
      sendStatus: noop,
      onStatus: unsub
    },
    feedback: {
      submitBugReport: P({ ok: false, error: 'window.api is unavailable (web build).' })
    },
    parts: {
      listLibraries: P([]),
      openPartsFolder: P(undefined),
      savePart: P({ ok: false, error: 'window.api is unavailable (preload not loaded).' }),
      deletePart: P({ ok: false }),
      promoteToStandard: P({ ok: false }),
      publishStandard: P({ ok: false }),
      createLibrary: P({ ok: false }),
      deleteLibrary: P({ ok: false }),
      fetchRegistry: P({ libraries: [] }),
      installLibrary: P({ ok: false }),
      checkUpdates: P([]),
      cachedUpdates: P([])
    },
    plugins: {
      list: P([]),
      reload: P({ plugins: [] }),
      runCommand: P({ ok: false }),
      // pythonFound:false routes RobotView to the benign "install Python to sync
      // poses" label; without this key the deepStub resolves [] and the view
      // misreads it as a broken managed block (spurious warning).
      motionRead: P({ ok: false, pythonFound: false })
    },
    git: {
      openRepo: P(null),
      status: P({
        isRepo: false,
        root: null,
        branch: null,
        tracking: null,
        ahead: 0,
        behind: 0,
        staged: [],
        changed: [],
        untracked: []
      }),
      stage: P(undefined),
      unstage: P(undefined),
      discard: P(undefined),
      commit: P(undefined),
      diff: P({ path: '', diff: '', staged: false }),
      currentBranch: P(undefined),
      listBranches: P({ current: '', branches: [] }),
      checkout: P(undefined),
      push: P({ summary: '' }),
      pull: P({ summary: '' })
    }
  }

  w.api = fill(api) as unknown as Window['api']
  w.electron = {
    process: { versions: {} },
    ipcRenderer: fill({
      on: unsub,
      once: noop,
      send: noop,
      invoke: P(undefined),
      removeListener: noop,
      removeAllListeners: noop
    })
  } as unknown as Window['electron']
}
