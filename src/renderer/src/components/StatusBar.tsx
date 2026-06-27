import { useCallback, useEffect, useRef, useState } from 'react'
import { useDeviceStatus } from '../hooks/useDeviceStatus'
import { useWorkspace } from '../store/workspace'
import { useConsole } from '../store/console'
import { useEditorSettings } from '../store/settings'
import { FirmwareFlasher } from './FirmwareFlasher'
import { CoffeeLink } from './CoffeeLink'
import { updateButtonView } from './updateButton'
import { liveWarningVisible } from './instrument-host'
import { micropythonVersionFromBanner, newerFirmware } from './firmware-version'
import type { FirmwareCatalog, UpdateStatus } from '../../../preload/index.d'
import './StatusBar.css'

/**
 * STATUS BAR (issue #71)
 * ======================
 *
 * A thin, persistent bar pinned at the very bottom of the window (below the
 * shell panel). It consolidates ambient state that previously lived in the
 * toolbar or had no home:
 *
 *   Left group  — device connection state and plugin status message(s).
 *   Right group — Git changed-file count, active-file line count, save status,
 *                 the app version slot, and a Flash-firmware button at the far
 *                 right. The version slot is update-aware (issue #74): it shows
 *                 `v<version>` normally, but becomes an Update / Restart button
 *                 (or a download-progress label) as an update progresses.
 *
 * Values are read from existing seams (never new global state):
 *   - connection: {@link useDeviceStatus}
 *   - update:     window.api.updates.onStatus
 *   - git:        window.api.git.status() for the workspace currentFolder
 *   - lines/save: the active file in {@link useWorkspace}
 *   - version:    window.api.appVersion()
 *   - plugin msg: posted into this bar via the global `snakie:status` event
 *                 (dispatched when a plugin returns a `status` action)
 */

/** A plugin-posted status message (mirrors the SDK `status` action shape). */
export interface PluginStatusMessage {
  text: string
  tooltip?: string
  href?: string
  priority?: number
}

/** Name of the window event the renderer dispatches for plugin status actions. */
export const PLUGIN_STATUS_EVENT = 'snakie:status'

export interface StatusBarProps {
  /**
   * Whether the GLOBAL instrument live-poll is on. When it is (and a board is
   * connected with ≥1 instrument open) the bar shows a warning that the poll is
   * interrupting the board, plus a quick-stop link.
   */
  instrumentsLive?: boolean
  /** How many scope/meter instruments are open (gates the warning). */
  instrumentCount?: number
  /** Stop the global live-poll (the quick-action behind the warning's link). */
  onStopLive?: () => void
}

export function StatusBar({
  instrumentsLive = false,
  instrumentCount = 0,
  onStopLive
}: StatusBarProps = {}): JSX.Element {
  const status = useDeviceStatus()
  const { openFiles, activeId, currentFolder } = useWorkspace()
  const consoleStore = useConsole()
  const settings = useEditorSettings()
  const activeFile = openFiles.find((f) => f.id === activeId) ?? null

  const [flasherOpen, setFlasherOpen] = useState(false)
  // A newer MicroPython than the connected device is running (#173), + dismissal.
  const [fwUpdate, setFwUpdate] = useState<{ current: string; latest: string } | null>(null)
  const [fwDismissed, setFwDismissed] = useState(false)
  const [update, setUpdate] = useState<UpdateStatus | null>(null)
  const [version, setVersion] = useState<string>('')
  const [changedCount, setChangedCount] = useState<number | null>(null)
  const [pluginMsg, setPluginMsg] = useState<PluginStatusMessage | null>(null)

  // App version — fetched once.
  useEffect(() => {
    let active = true
    window.api
      .appVersion()
      .then((v) => {
        if (active) setVersion(v)
      })
      .catch(() => undefined)
    return () => {
      active = false
    }
  }, [])

  // Update lifecycle — subscribe to push events.
  useEffect(() => window.api.updates.onStatus((s) => setUpdate(s)), [])

  // Plugin status messages — dispatched as a window event when a plugin command
  // returns a `status` action (see PluginsPanel). The highest-priority message
  // wins; an empty text clears the slot.
  useEffect(() => {
    const handler = (e: Event): void => {
      const detail = (e as CustomEvent<PluginStatusMessage>).detail
      if (!detail || !detail.text) {
        setPluginMsg(null)
        return
      }
      setPluginMsg((prev) =>
        prev && (prev.priority ?? 0) > (detail.priority ?? 0) ? prev : detail
      )
    }
    window.addEventListener(PLUGIN_STATUS_EVENT, handler)
    return () => window.removeEventListener(PLUGIN_STATUS_EVENT, handler)
  }, [])

  // Git changed-file count — best-effort for the workspace folder. Debounced,
  // and refreshed on window focus + folder change. Tolerates non-repo / no
  // folder by showing nothing.
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const refreshGit = useCallback(() => {
    if (!currentFolder) {
      setChangedCount(null)
      return
    }
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      void (async () => {
        try {
          // The main-process GitService is scoped to one repo; point it at the
          // current folder (idempotent) before reading status. The Source
          // Control panel does the same, so this stays in sync.
          await window.api.git.openRepo(currentFolder)
          const st = await window.api.git.status()
          if (!st.isRepo) {
            setChangedCount(null)
            return
          }
          setChangedCount(st.staged.length + st.changed.length + st.untracked.length)
        } catch {
          setChangedCount(null)
        }
      })()
    }, 300)
  }, [currentFolder])

  useEffect(() => {
    refreshGit()
    const onFocus = (): void => refreshGit()
    window.addEventListener('focus', onFocus)
    return () => {
      window.removeEventListener('focus', onFocus)
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [refreshGit])

  const connected = status.state === 'connected'
  const connLabel =
    status.state === 'connecting'
      ? 'Connecting…'
      : connected
        ? `Connected${status.path ? ` · ${status.path}` : ''}`
        : status.state === 'error'
          ? 'Error'
          : 'Disconnected'

  // Detect a newer MicroPython for the connected device (#173): read its running
  // version from the REPL boot banner and compare against the firmware catalog's
  // newest stable build. Runs once per connection, only when the setting is on.
  useEffect(() => {
    if (!connected || !settings.checkFirmwareUpdates) {
      setFwUpdate(null)
      setFwDismissed(false)
      return
    }
    let alive = true
    let catalog: FirmwareCatalog | null = null
    let done = false
    const run = async (): Promise<void> => {
      if (done) return
      const v = micropythonVersionFromBanner(consoleStore.getAll())
      if (!v) return // no banner yet — wait for device output
      done = true
      if (!catalog) {
        try {
          catalog = await window.api.firmware.fetchCatalog()
        } catch {
          return // offline / catalog unreachable — degrade silently
        }
      }
      if (alive) setFwUpdate(newerFirmware(v, catalog))
    }
    void run() // seed from any banner already in the console
    const decoder = new TextDecoder()
    let tail = ''
    const off = window.api.device.onData((chunk) => {
      tail = (tail + decoder.decode(chunk, { stream: true })).slice(-4096)
      if (!done && /micropython/i.test(tail)) void run()
    })
    return () => {
      alive = false
      off()
    }
  }, [connected, settings.checkFirmwareUpdates, consoleStore])

  const lines = activeFile ? activeFile.content.split('\n').length : null

  // The instrument live-poll warning (+ quick stop). Shows ONLY while live
  // polling is on AND a board is connected AND ≥1 scope/meter is open — i.e. the
  // exact condition under which the poll is entering the raw REPL and
  // interrupting a running program. The gate is the pure, unit-tested
  // `liveWarningVisible`.
  const showLiveWarning = liveWarningVisible(instrumentsLive, connected, instrumentCount)

  // Update-aware version slot (issue #74). The pure mapping lives in
  // `updateButton.ts` so it can be unit-tested without rendering.
  const updateView = updateButtonView(update, version)
  const onUpdateClick = (): void => {
    if (updateView.action === 'download') void window.api.updates.download()
    else if (updateView.action === 'quitAndInstall') void window.api.updates.quitAndInstall()
  }

  // The plain version text is itself clickable: it runs the same user-initiated
  // update check as the "Check for Updates…" menu item (issue #89). When an
  // update is already known the slot becomes the issue-#74 Update/Restart button
  // instead, handled by `onUpdateClick` above.
  const onVersionClick = (): void => {
    void window.api.updates.check()
  }

  return (
    <footer className="statusbar" role="contentinfo" aria-label="Status bar">
      <div className="statusbar__group statusbar__group--left">
        <span
          className={`statusbar__item statusbar__conn ${connected ? 'statusbar__conn--connected' : 'statusbar__conn--disconnected'}`}
          title={status.error ? `Connection error: ${status.error}` : 'Device connection status'}
        >
          <span className="statusbar__dot" aria-hidden="true" />
          <span>{connLabel}</span>
        </span>

        {showLiveWarning && (
          <span
            className="statusbar__item statusbar__live-warn"
            title="The instrument live poll enters the REPL and interrupts a running program every ~0.8s"
          >
            <span aria-hidden="true">⚡</span>
            <span>Live polling is interrupting the board</span>
            <button
              type="button"
              className="statusbar__live-stop"
              onClick={onStopLive}
              title="Stop live polling"
              aria-label="Stop live polling"
            >
              Stop
            </button>
          </span>
        )}

        {pluginMsg &&
          (pluginMsg.href ? (
            <button
              type="button"
              className="statusbar__item statusbar__link"
              title={pluginMsg.tooltip ?? pluginMsg.href}
              onClick={() => {
                if (pluginMsg.href) void window.api.openExternal(pluginMsg.href)
              }}
            >
              {pluginMsg.text}
            </button>
          ) : (
            <span
              className="statusbar__item statusbar__plugin"
              title={pluginMsg.tooltip ?? undefined}
            >
              {pluginMsg.text}
            </span>
          ))}
      </div>

      <div className="statusbar__spacer" />

      <div className="statusbar__group statusbar__group--right">
        {changedCount != null && (
          <span
            className="statusbar__item"
            title={`${changedCount} changed file(s) in the current repository`}
          >
            ⎇ {changedCount}
          </span>
        )}
        {lines != null && (
          <span className="statusbar__item" title="Lines in the active file">
            {lines} {lines === 1 ? 'line' : 'lines'}
          </span>
        )}
        <span
          className={`statusbar__item statusbar__save ${activeFile?.dirty ? 'statusbar__save--dirty' : ''}`}
          title={activeFile ? (activeFile.dirty ? 'Unsaved changes' : 'All changes saved') : 'No active file'}
        >
          {activeFile ? (activeFile.dirty ? 'Unsaved' : 'Saved') : '—'}
        </span>
        {updateView.label &&
          (updateView.clickable ? (
            <button
              type="button"
              className="statusbar__item statusbar__update-btn"
              title={updateView.title}
              onClick={onUpdateClick}
            >
              {updateView.label}
            </button>
          ) : updateView.isUpdate ? (
            // A non-clickable update state (downloading, or error fallback):
            // passive label, no check-for-updates affordance.
            <span
              className="statusbar__item statusbar__update"
              title={updateView.title}
            >
              {updateView.label}
            </span>
          ) : (
            // Plain version: click to run the same manual check as the
            // "Check for Updates…" menu item (issue #89).
            <button
              type="button"
              className="statusbar__item statusbar__version"
              title="Check for updates"
              onClick={onVersionClick}
            >
              {updateView.label}
            </button>
          ))}
        <CoffeeLink />
        <div className="statusbar__flash-wrap">
          {/* Newer-firmware prompt, anchored above the flash button (#173). */}
          {fwUpdate && !fwDismissed && (
            <div className="statusbar__fw-popup" role="status">
              <span className="statusbar__fw-text">
                MicroPython <strong>v{fwUpdate.latest}</strong> is available (device runs v{fwUpdate.current}).
              </span>
              <button
                type="button"
                className="statusbar__fw-flash"
                onClick={() => {
                  setFlasherOpen(true)
                  setFwDismissed(true)
                }}
              >
                Flash
              </button>
              <button
                type="button"
                className="statusbar__fw-dismiss"
                onClick={() => setFwDismissed(true)}
                title="Dismiss"
                aria-label="Dismiss firmware update notice"
              >
                ✕
              </button>
            </div>
          )}
          <button
            type="button"
            className="statusbar__item statusbar__flash"
            onClick={() => setFlasherOpen(true)}
            title={
              fwUpdate
                ? `MicroPython v${fwUpdate.latest} available (device runs v${fwUpdate.current}). Flash firmware.`
                : 'Flash MicroPython firmware to the device (ESP via esptool, RP2040 via UF2)'
            }
            aria-label="Flash MicroPython firmware"
          >
            <span aria-hidden="true">⚡</span>
            <span>Flash firmware</span>
            {fwUpdate && !fwDismissed && <span className="statusbar__fw-badge" aria-hidden="true" />}
          </button>
        </div>
      </div>

      {flasherOpen && <FirmwareFlasher onClose={() => setFlasherOpen(false)} />}
    </footer>
  )
}
