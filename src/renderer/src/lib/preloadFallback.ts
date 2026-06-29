/**
 * Preload-bridge fallback.
 *
 * In Electron, `window.api` / `window.electron` are injected by the preload
 * script. Outside Electron — a plain browser, or if the preload ever fails to
 * load — they are `undefined`, and any component that touches them on mount
 * (e.g. the Toolbar via `useDeviceStatus`) would throw and crash the whole
 * renderer to a blank screen.
 *
 * This installs a no-op fallback that returns "disconnected / empty" defaults
 * so the UI still renders and degrades gracefully. It is imported for its side
 * effect from `main.tsx` BEFORE React renders. In real Electron the bridge is
 * already present, so this is a safety net only (and logs a warning if used).
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
      `firmware, LLM, package and Git features are inert. ` +
      (inElectron
        ? 'Running in Electron, so the PRELOAD FAILED TO LOAD — check the preload path / sandbox setting.'
        : 'Not running inside Electron (e.g. a browser preview).')
  )

  const api = {
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
      getKeyStatus: P({ hasKey: false, secure: false }),
      setKey: P(undefined),
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
      probeInstalled: P([])
    },
    updates: {
      check: P(undefined),
      quitAndInstall: P(undefined),
      onStatus: unsub
    },
    board: {
      open: P(undefined),
      close: noop,
      update: noop,
      requestSource: P(null),
      onSource: unsub,
      onClosed: unsub,
      listUserBoards: P([]),
      openBoardsFolder: P(undefined),
      saveUserBoard: P({ ok: true }),
      deleteUserBoard: P(undefined)
    },
    instruments: {
      open: noop,
      onOpen: unsub,
      librarySource: P('')
    },
    parts: {
      listLibraries: P([]),
      openPartsFolder: P(undefined),
      savePart: P({ ok: false, error: 'window.api is unavailable (preload not loaded).' }),
      deletePart: P({ ok: false }),
      promoteToStandard: P({ ok: false }),
      createLibrary: P({ ok: false }),
      deleteLibrary: P({ ok: false }),
      fetchRegistry: P({ libraries: [] }),
      installLibrary: P({ ok: false }),
      checkUpdates: P([]),
      cachedUpdates: P([])
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

  w.api = api as unknown as Window['api']
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
