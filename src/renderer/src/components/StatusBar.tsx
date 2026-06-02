import { useCallback, useEffect, useRef, useState } from 'react'
import { useDeviceStatus } from '../hooks/useDeviceStatus'
import { useWorkspace } from '../store/workspace'
import { FirmwareFlasher } from './FirmwareFlasher'
import { updateButtonView } from './updateButton'
import type { UpdateStatus } from '../../../preload/index.d'
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

export function StatusBar(): JSX.Element {
  const status = useDeviceStatus()
  const { openFiles, activeId, currentFolder } = useWorkspace()
  const activeFile = openFiles.find((f) => f.id === activeId) ?? null

  const [flasherOpen, setFlasherOpen] = useState(false)
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

  const lines = activeFile ? activeFile.content.split('\n').length : null

  // Update-aware version slot (issue #74). The pure mapping lives in
  // `updateButton.ts` so it can be unit-tested without rendering.
  const updateView = updateButtonView(update, version)
  const onUpdateClick = (): void => {
    if (updateView.action === 'download') void window.api.updates.download()
    else if (updateView.action === 'quitAndInstall') void window.api.updates.quitAndInstall()
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
          ) : (
            <span
              className={`statusbar__item ${updateView.isUpdate ? 'statusbar__update' : 'statusbar__version'}`}
              title={updateView.title}
            >
              {updateView.label}
            </span>
          ))}
        <button
          type="button"
          className="statusbar__item statusbar__flash"
          onClick={() => setFlasherOpen(true)}
          title="Flash MicroPython firmware to the device (ESP via esptool, RP2040 via UF2)"
          aria-label="Flash MicroPython firmware"
        >
          <span aria-hidden="true">⚡</span>
          <span>Flash firmware</span>
        </button>
      </div>

      {flasherOpen && <FirmwareFlasher onClose={() => setFlasherOpen(false)} />}
    </footer>
  )
}
