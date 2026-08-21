import { useCallback, useEffect, useRef, useState } from 'react'
import { useDeviceStatus } from '../hooks/useDeviceStatus'
import { useWorkspace } from '../store/workspace'
import { useConsole } from '../store/console'
import { useEditorSettings } from '../store/settings'
import { FirmwareFlasher } from './FirmwareFlasher'
import { CoffeeLink } from './CoffeeLink'
import { updateButtonView } from './updateButton'
import { liveWarningVisible } from './instrument-host'
import {
  circuitPythonUpdate,
  displayVersion,
  lastMicropythonBanner,
  micropythonVersionFromBanner,
  firmwareFamilyFromBanner,
  microPythonUpdate,
  type FirmwareUpdate
} from './firmware-version'
import {
  STATUS_TIPS,
  TIP_FADE_MS,
  nextTipDelayMs,
  pickTipIndex,
  shouldShowTip,
  type StatusTip
} from './status-tips'
import { isVirtualPort, VIRTUAL_PORT_SHORT } from '../../../shared/virtual-device'
import { runtimeLabel } from '../../../shared/dialect'
import {
  FIRMWARE_RUNTIME_LABEL,
  firmwareRuntimeForDialect
} from '../../../shared/firmware-runtime'
import type { FirmwareCatalog, UpdateStatus } from '../../../preload/index.d'
import { BulbIcon } from './ui-icons'
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
  // A newer build than the connected device is running — MicroPython (#173) or
  // CircuitPython (#757) — plus dismissal. The update names its own runtime, so
  // the prompt never tells a CircuitPython user about a MicroPython release.
  const [fwUpdate, setFwUpdate] = useState<FirmwareUpdate | null>(null)
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
  // Which Python the board is actually running (#752). Absent until the connect
  // probe answers, and absent for good on a board that wouldn't say — so this
  // renders nothing rather than guessing MicroPython, which is exactly the
  // assumption the CircuitPython epic (#209) exists to remove.
  const runtime = connected ? runtimeLabel(status.runtime ?? null) : ''
  /**
   * Which Python the flash dialog should OPEN on (#756). The connected board's
   * own dialect when it said, MicroPython otherwise — the dialog's own selector
   * is what actually decides, this only saves a step. A board that never
   * identified itself gets the historical default rather than a guess dressed up
   * as detection.
   */
  const flashRuntime = firmwareRuntimeForDialect(status.runtime?.dialect) ?? 'micropython'
  const flashRuntimeLabel = FIRMWARE_RUNTIME_LABEL[flashRuntime]
  /**
   * Which firmware-update check applies (#757). A BOOLEAN rather than the
   * dialect string, deliberately: the MicroPython effect below depends on it,
   * and `undefined → 'micropython'` (which is what a MicroPython connect does a
   * beat after connecting) must not count as a change and re-run it.
   */
  const circuitPython = status.runtime?.dialect === 'circuitpython'
  // Offline mode (#135): connected to the built-in simulated device, not real
  // hardware — surfaced with a distinct label + badge so it's never mistaken
  // for a physical board.
  const simulated = connected && isVirtualPort(status.path)
  const connLabel =
    status.state === 'connecting'
      ? 'Connecting…'
      : simulated
        ? `${VIRTUAL_PORT_SHORT} · offline`
        : connected
          ? `Connected${status.path ? ` · ${status.path}` : ''}`
          : status.state === 'error'
            ? 'Error'
            : 'Disconnected'

  /**
   * Detect a newer CircuitPython for the connected board (#757).
   *
   * Nothing is scraped here: the session already probed what it is talking to
   * (#752) and, where a CIRCUITPY drive was unambiguously paired to this port,
   * already read the per-board id out of `boot_out.txt` (#753). So this is one
   * catalog fetch and one pure decision. A board with no id yields no offer —
   * CircuitPython builds are per board, and there is no near-enough build.
   *
   * Runs only for a CircuitPython session, so the MicroPython path below is
   * untouched and the two can never both fire.
   */
  useEffect(() => {
    if (!connected || !settings.checkFirmwareUpdates || !circuitPython) return
    let alive = true
    void (async () => {
      let catalog: FirmwareCatalog
      try {
        catalog = await window.api.firmware.fetchCatalog('circuitpython')
      } catch {
        return // offline / catalog unreachable — degrade silently
      }
      if (alive) setFwUpdate(circuitPythonUpdate(status.runtime, catalog))
    })()
    return () => {
      alive = false
    }
    // `status.runtime` is the whole input: a re-probe (or a different board)
    // re-runs the check, and nothing else needs to.
  }, [connected, settings.checkFirmwareUpdates, circuitPython, status.runtime])

  // Detect a newer MicroPython for the connected device (#173): read its running
  // version from the REPL boot banner and compare against the firmware catalog's
  // newest stable build. Runs once per connection, only when the setting is on.
  useEffect(() => {
    if (!connected || !settings.checkFirmwareUpdates) {
      setFwUpdate(null)
      setFwDismissed(false)
      return
    }
    // A CircuitPython board is the effect above's job — and its banner does not
    // say "MicroPython", so this would find nothing anyway. Returning keeps it
    // from also subscribing to the data stream for a board it can't help.
    if (circuitPython) return
    let alive = true
    let catalog: FirmwareCatalog | null = null
    let done = false
    const run = async (): Promise<void> => {
      if (done) return
      // Read the MOST-RECENT banner only: the console buffer still holds an
      // earlier device's banner (e.g. a micro:bit unplugged just before), so
      // both the version AND the family must come from the live device's line.
      const banner = lastMicropythonBanner(consoleStore.getAll())
      const v = micropythonVersionFromBanner(banner ?? '')
      // Don't finalise until we can identify BOTH the version AND the board family
      // from the banner. The banner arrives over serial in chunks, so the version
      // can land before the trailing `… with RP2040`; latching then would lose the
      // family and fall back to the catalog-wide max (a micro:bit build offered to
      // a Pico). Returning early — without setting `done` — re-checks as the rest
      // of the banner arrives.
      const family = firmwareFamilyFromBanner(banner)
      if (!v || !family) return
      done = true
      if (!catalog) {
        try {
          catalog = await window.api.firmware.fetchCatalog()
        } catch {
          return // offline / catalog unreachable — degrade silently
        }
      }
      // The pure decision (scoped to the device's own family) lives in
      // `microPythonUpdate` so it's unit-tested against the race.
      if (alive) setFwUpdate(microPythonUpdate(consoleStore.getAll(), catalog))
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
  }, [connected, settings.checkFirmwareUpdates, consoleStore, circuitPython])

  const lines = activeFile ? activeFile.content.split('\n').length : null

  // The instrument live-poll warning (+ quick stop). Shows ONLY while live
  // polling is on AND a board is connected AND ≥1 scope/meter is open — i.e. the
  // exact condition under which the poll is entering the raw REPL and
  // interrupting a running program. The gate is the pure, unit-tested
  // `liveWarningVisible`.
  const showLiveWarning = liveWarningVisible(instrumentsLive, connected, instrumentCount)

  // Discovery tips (issue #434) — a rotating 💡 tip in the otherwise-empty
  // message area. `shouldShowTip` (pure, unit-tested) gates it: tips ALWAYS
  // give way to the live-poll warning and plugin messages, and the Settings →
  // Appearance toggle turns them off entirely. While shown, a new random tip
  // (never the previous one) is picked every 5–10 minutes with a ~1s CSS
  // opacity fade out/in around the swap.
  const [tip, setTip] = useState<StatusTip | null>(null)
  const [tipFaded, setTipFaded] = useState(true)
  const tipIndexRef = useRef<number | null>(null)
  const tipSlotFree = shouldShowTip({
    enabled: settings.showTips,
    liveWarning: showLiveWarning,
    hasPluginMessage: pluginMsg != null
  })

  useEffect(() => {
    if (!tipSlotFree || STATUS_TIPS.length === 0) {
      // Real content owns the bar (or tips are off) — vacate immediately.
      setTip(null)
      setTipFaded(true)
      return
    }
    let alive = true
    const timers: ReturnType<typeof setTimeout>[] = []
    const later = (ms: number, fn: () => void): void => {
      timers.push(
        setTimeout(() => {
          if (alive) fn()
        }, ms)
      )
    }
    const show = (): void => {
      const i = pickTipIndex(STATUS_TIPS.length, tipIndexRef.current)
      tipIndexRef.current = i
      setTip(STATUS_TIPS[i])
      // Mounted at opacity 0; lift the flag a beat later so the CSS
      // transition runs the fade-in.
      later(30, () => setTipFaded(false))
      later(nextTipDelayMs(), rotate)
    }
    const rotate = (): void => {
      setTipFaded(true) // fade out…
      later(TIP_FADE_MS, show) // …then swap in the next tip and fade back in
    }
    setTipFaded(true)
    show()
    return () => {
      alive = false
      timers.forEach(clearTimeout)
    }
  }, [tipSlotFree])

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
          className={`statusbar__item statusbar__conn ${
            simulated
              ? 'statusbar__conn--sim'
              : connected
                ? 'statusbar__conn--connected'
                : 'statusbar__conn--disconnected'
          }`}
          title={
            status.error
              ? `Connection error: ${status.error}`
              : simulated
                ? 'Simulated device — no hardware connected (offline mode)'
                : 'Device connection status'
          }
        >
          <span className="statusbar__dot" aria-hidden="true" />
          <span>{connLabel}</span>
        </span>

        {runtime && (
          <span
            className="statusbar__item statusbar__runtime"
            title={
              status.runtime?.machine
                ? `${runtime} — ${status.runtime.machine}`
                : `The board is running ${runtime}`
            }
          >
            {runtime}
          </span>
        )}

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

        {/* Discovery tip (#434) — only rendered while the bar is otherwise
            empty (tipSlotFree); real messages above always take its place.
            Tips with an href open the docs article in the external browser. */}
        {tipSlotFree &&
          tip &&
          (tip.href ? (
            <button
              type="button"
              className={`statusbar__item statusbar__tip statusbar__tip--link${
                tipFaded ? ' statusbar__tip--faded' : ''
              }`}
              title={tip.href}
              onClick={() => {
                if (tip.href) void window.api.openExternal(tip.href)
              }}
            >
              <BulbIcon size={11} />
              <span className="statusbar__tip-text">{tip.text}</span>
            </button>
          ) : (
            <span
              className={`statusbar__item statusbar__tip${
                tipFaded ? ' statusbar__tip--faded' : ''
              }`}
            >
              <BulbIcon size={11} />
              <span className="statusbar__tip-text">{tip.text}</span>
            </span>
          ))}
      </div>

      <div className="statusbar__spacer" />

      <div className="statusbar__group statusbar__group--right">
        {changedCount != null && (
          <span
            className="statusbar__item"
            title={`${changedCount} changed file(s) in the current repository`}
            aria-label={`${changedCount} changed files`}
          >
            <span aria-hidden="true">⎇</span> {changedCount}
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
          {/* Newer-firmware prompt, anchored above the flash button (#173, #757).
              It names the runtime it is offering — a CircuitPython board must
              never be told a MicroPython release is available. */}
          {fwUpdate && !fwDismissed && (
            <div className="statusbar__fw-popup" role="status">
              <span className="statusbar__fw-text">
                {FIRMWARE_RUNTIME_LABEL[fwUpdate.runtime]}{' '}
                <strong>{displayVersion(fwUpdate.runtime, fwUpdate.latest)}</strong> is available
                (device runs {displayVersion(fwUpdate.runtime, fwUpdate.current)}).
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
                ? `${FIRMWARE_RUNTIME_LABEL[fwUpdate.runtime]} ${displayVersion(fwUpdate.runtime, fwUpdate.latest)} available (device runs ${displayVersion(fwUpdate.runtime, fwUpdate.current)}). Flash firmware.`
                : `Flash ${flashRuntimeLabel} firmware to the device (ESP via esptool, UF2 boards by drive copy)`
            }
            aria-label={`Flash ${flashRuntimeLabel} firmware`}
          >
            <span aria-hidden="true">⚡</span>
            <span>Flash firmware</span>
            {fwUpdate && !fwDismissed && <span className="statusbar__fw-badge" aria-hidden="true" />}
          </button>
        </div>
      </div>

      {flasherOpen && (
        <FirmwareFlasher
          onClose={() => setFlasherOpen(false)}
          runtime={flashRuntime}
          boardId={status.runtime?.boardId}
        />
      )}
    </footer>
  )
}
