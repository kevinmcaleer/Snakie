/**
 * Preload-bridge fallback.
 *
 * In Electron, `window.api` / `window.electron` are injected by the preload
 * script. Outside Electron — a plain browser (e.g. the `build:web` /
 * `dev:web` smoke-test SPA, #281/#267), or if the preload ever fails to load —
 * they are `undefined`, and any component that touches them on mount (e.g. the
 * status bar's `appVersion()`, or the app shell's `robot.onChanged()` /
 * `find.onCommand()` subscriptions) would throw and crash the whole renderer
 * to a blank screen.
 *
 * This installs a no-op fallback that returns "disconnected / empty" defaults
 * so the UI still renders and degrades gracefully. It is imported for its side
 * effect from `main.tsx` BEFORE React renders. In real Electron the bridge is
 * already present, so this is a safety net only (and logs a warning if used).
 *
 * The stub below is typed as `Window['api']` (i.e. the `Api` type from
 * `src/preload/index.d.ts`) rather than cast away, so it MUST cover every
 * namespace/method the real preload exposes — if a future change adds a
 * method to `Api` and this file isn't updated, `npm run typecheck` fails here
 * instead of the gap surfacing as a silent runtime crash outside Electron.
 */
const noop = (): void => {}
const unsub = (): (() => void) => noop
const P =
  <T>(value: T) =>
  (): Promise<T> =>
    Promise.resolve(value)

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
      `firmware, LLM, package, Git, plugin and robot features are inert. ` +
      (inElectron
        ? 'Running in Electron, so the PRELOAD FAILED TO LOAD — check the preload path / sandbox setting.'
        : 'Not running inside Electron (e.g. a browser preview or the web build target).')
  )

  const unavailable = 'window.api is unavailable (preload not loaded).'

  const api: Window['api'] = {
    ping: P('pong'),
    appVersion: P(''),
    diagnostics: P({
      platform: '',
      arch: '',
      osVersion: '',
      electron: '',
      snakieVersion: ''
    }),
    captureScreenshot: P([]),
    openExternal: P(undefined),
    // Real Electron's `versions` is `process.versions` (Node/Chrome/Electron
    // build numbers). No such thing exists in a plain browser, so this is
    // deliberately cast away rather than faked with plausible-looking values.
    versions: {} as Window['api']['versions'],
    device: {
      listPorts: P([]),
      connect: P(undefined),
      disconnect: P(undefined),
      getStatus: P({ state: 'disconnected' }),
      exec: P({ stdout: '', stderr: '' }),
      eval: P(''),
      sendData: P(undefined),
      sendControl: P(undefined),
      interrupt: P(undefined),
      softReset: P(undefined),
      listDir: P([]),
      df: P(null),
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
      saveFileDialog: P(null),
      readDir: P([]),
      readFile: P(''),
      writeFile: P(undefined),
      mkdir: P(undefined),
      rename: P(undefined),
      remove: P(undefined),
      stat: P({ isDir: false, size: 0, mtimeMs: 0 })
    },
    updates: {
      check: P(undefined),
      download: P(undefined),
      quitAndInstall: P(undefined),
      onStatus: unsub
    },
    packages: {
      topPackages: P([]),
      search: P([]),
      install: P({ name: '', ok: false, log: unavailable, notes: [] })
    },
    modules: {
      catalog: P([]),
      installPlan: P({ id: '', importName: '', mechanism: 'mip', notes: [] }),
      install: P({ id: '', ok: false, log: unavailable, notes: [] }),
      probeInstalled: P([]),
      notifyChanged: noop,
      onChanged: unsub
    },
    llm: {
      listProviders: P([]),
      getKeyStatus: P({ hasKey: false, secure: false }),
      setKey: P(undefined),
      sendMessage: P(''),
      complete: P(''),
      copilotDeviceStart: P({
        deviceCode: '',
        userCode: '',
        verificationUri: '',
        intervalSeconds: 5,
        expiresInSeconds: 0
      }),
      copilotDevicePoll: P({ status: 'pending' }),
      onStream: unsub
    },
    firmware: {
      detectBoards: P([]),
      checkEsptool: P({ available: false }),
      pickFirmwareFile: P(null),
      flash: P({ ok: false, error: unavailable }),
      fetchCatalog: P({ families: [] }),
      downloadAndFlash: P({ ok: false, error: unavailable }),
      onProgress: unsub
    },
    git: {
      openRepo: P(null),
      status: P({
        isRepo: false,
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
      listBranches: P({ branches: [] }),
      checkout: P(undefined),
      push: P({ summary: '' }),
      pull: P({ summary: '' })
    },
    plugins: {
      status: P({ pythonFound: false, error: unavailable }),
      list: P({ plugins: [], commands: [] }),
      runCommand: P({ actions: [] }),
      lint: P({ diagnostics: [] }),
      reload: P({ pythonFound: false, error: unavailable })
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
      saveUserBoard: P({ ok: false, error: unavailable }),
      deleteUserBoard: P(undefined)
    },
    instruments: {
      open: noop,
      onOpen: unsub,
      librarySource: P(''),
      openWindow: P(undefined),
      closeWindow: noop,
      requestWindowPayload: P(null),
      onWindowPayload: unsub,
      onWindowClosed: unsub
    },
    find: {
      open: P(undefined),
      close: noop,
      onClosed: unsub,
      sendCommand: noop,
      onCommand: unsub,
      sendStatus: noop,
      onStatus: unsub
    },
    console: {
      open: P(undefined),
      requestSeed: P(''),
      close: noop,
      onClosed: unsub
    },
    parts: {
      listLibraries: P([]),
      openPartsFolder: P(undefined),
      savePart: P({ ok: false, error: unavailable }),
      deletePart: P({ ok: false, error: unavailable }),
      promoteToStandard: P({ ok: false, error: unavailable }),
      publishStandard: P({ ok: false, error: unavailable }),
      createLibrary: P({ ok: false, error: unavailable }),
      deleteLibrary: P({ ok: false, error: unavailable }),
      readDriverSource: P({ ok: false, error: unavailable }),
      fetchRegistry: P({ libraries: [] }),
      installLibrary: P({ ok: false, error: unavailable }),
      checkUpdates: P([]),
      cachedUpdates: P([]),
      onChanged: unsub
    },
    robot: {
      load: P({ parts: [], connections: [] }),
      save: P({ ok: false, error: unavailable }),
      onChanged: unsub
    },
    feedback: {
      submitBugReport: P({ ok: false, error: unavailable })
    }
  }

  w.api = api
  w.electron = {
    process: { versions: {} },
    ipcRenderer: {
      on: unsub,
      once: noop,
      send: noop,
      invoke: P(undefined),
      removeListener: noop,
      removeAllListeners: noop
    }
  } as unknown as Window['electron']
}
