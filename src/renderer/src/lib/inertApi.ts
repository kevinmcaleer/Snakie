/**
 * The INERT `window.api` — every namespace answers with a safe "disconnected /
 * empty / unavailable" default instead of throwing. Used two ways:
 *
 *  - {@link preloadFallback} installs it verbatim as a crash-guard when the
 *    Electron preload bridge is missing (outside Electron, or a broken
 *    preload load).
 *  - The web build (`createWebApi`, epic #267 Phase W1) layers REAL
 *    `device`/`fs`/`robot` implementations on top of this as its base, so
 *    every namespace Snakie-for-Web doesn't implement yet (Git, plugins, LLM,
 *    firmware flashing, package installs, detached OS windows, …) degrades
 *    explicitly rather than crashing — matching the epic's "a feature lands
 *    on both or degrades explicitly" invariant.
 *
 * Error messages use generic "not available in this build" phrasing (rather
 * than Electron-specific wording like "preload not loaded") since the exact
 * same stub value is shown in both contexts above.
 */
import type { Api } from '../../../preload/index'

const noop = (): void => {}
const unsub = (): (() => void) => noop
const P =
  <T>(value: T) =>
  (): Promise<T> =>
    Promise.resolve(value)

const unavailable = 'This feature is not available in this build.'

/** Build a fresh inert `Api`. A factory (not a singleton) so callers can layer
 *  their own overrides on top without sharing mutable state. Typed directly
 *  against {@link Api} (no unsafe cast) so a missing/mismatched member is a
 *  compile error here instead of a runtime crash the first time some UI
 *  component calls it — this caught several real gaps (`modules.onChanged`,
 *  `board.onOpened`/`selectBoard`, detached instrument windows, …) that a
 *  blanket `as unknown as Api` cast had been silently hiding. */
export function createInertApi(): Api {
  const api: Api = {
    ping: P('pong (inert)'),
    appVersion: P('0.0.0'),
    diagnostics: P({
      platform: typeof navigator !== 'undefined' ? navigator.platform : 'unknown',
      arch: 'unknown',
      osVersion: 'unknown',
      electron: 'n/a',
      snakieVersion: '0.0.0'
    }),
    captureScreenshot: P([]),
    feedback: {
      submitBugReport: P({ ok: false, error: unavailable })
    },
    openExternal: (url: string): Promise<void> => {
      if (typeof window !== 'undefined') window.open(url, '_blank', 'noopener,noreferrer')
      return Promise.resolve()
    },
    versions: {
      node: '',
      v8: '',
      uv: '',
      zlib: '',
      brotli: '',
      ares: '',
      modules: '',
      nghttp2: '',
      napi: '',
      llhttp: '',
      openssl: '',
      cpu: '',
      unicode: '',
      electron: '',
      chrome: '',
      http_parser: ''
    } as NodeJS.ProcessVersions,
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
      sendControl: P(undefined),
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
    firmware: {
      detectBoards: P([]),
      checkEsptool: P({ available: false }),
      pickFirmwareFile: P(null),
      flash: P({ ok: false, error: unavailable }),
      fetchCatalog: P({ families: [] }),
      downloadAndFlash: P({ ok: false, error: unavailable }),
      onProgress: unsub
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
      copilotDevicePoll: P({ status: 'error', message: unavailable }),
      onStream: unsub
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
    updates: {
      check: P(undefined),
      download: P(undefined),
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
    console: {
      open: P(undefined),
      requestSeed: P(''),
      close: noop,
      onClosed: unsub
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
    parts: {
      listLibraries: P([]),
      openPartsFolder: P(undefined),
      savePart: P({ ok: false, error: unavailable }),
      deletePart: P({ ok: false, error: unavailable }),
      promoteToStandard: P({ ok: false, error: unavailable }),
      publishStandard: P({ ok: false, error: unavailable }),
      createLibrary: P({ ok: false, error: unavailable }),
      deleteLibrary: P({ ok: false, error: unavailable }),
      fetchRegistry: P({ libraries: [] }),
      installLibrary: P({ ok: false, error: unavailable }),
      checkUpdates: P([]),
      cachedUpdates: P([]),
      readDriverSource: P({ ok: false, error: unavailable }),
      onChanged: unsub
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
    robot: {
      load: P({ parts: [], connections: [] }),
      save: P({ ok: false, error: unavailable }),
      onChanged: unsub
    }
  }

  return api
}
