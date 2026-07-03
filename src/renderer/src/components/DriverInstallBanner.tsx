import { useEffect, useMemo, useState } from 'react'
import { driverInstallMethod, type PartDriverNeed } from './part-editor.util'
import { installPartDriver } from './driver-install'
import type { DriverFile } from '../../../preload/index.d'
import './DriverInstallBanner.css'

/**
 * DRIVER INSTALL BANNER (#184)
 * ============================
 *
 * A consent-first prompt shown in the Board View when placed parts on the
 * breadboard declare MicroPython driver file(s) they need on the board. It lists
 * the parts (deduped) and offers a single "Install drivers" action — nothing is
 * copied to the device without the user clicking it.
 *
 * Per driver, the install mechanism is chosen by {@link driverInstallMethod}:
 *  - `mip`  → `window.api.packages.install(source, { target })` (a github:/pypi:
 *             spec or a bare micropython-lib package name);
 *  - `copy` → read the file's source (a bundled file in the part folder, or an
 *             http(s) URL — both via `parts.readDriverSource` in main, past the
 *             renderer CSP) then `device.mkdir` each ancestor folder + write it to
 *             its `target` path with `device.writeFile`.
 *
 * The banner is BOARD-AWARE: it stats each `copy` driver's target on the connected
 * board and shows only the drivers that are actually MISSING — so it clears once
 * they're installed (its own install, or another window's, via the shared
 * `modules.onChanged` signal), instead of lingering forever. Installing touches the
 * device, so the action is disabled until a board is connected.
 */

/** Per-driver install state, keyed by {@link driverKey}. */
type DriverState = 'pending' | 'installing' | 'ok' | 'error'
interface DriverStatus {
  state: DriverState
  message?: string
}

export interface DriverInstallBannerProps {
  /** The placed parts that declare drivers (from `placedPartsNeedingDrivers`). */
  needs: PartDriverNeed[]
}

/** A stable id for one driver ROW, independent of its list position — so filtering
 *  out already-present drivers never shuffles the status/probe keys. */
function driverKey(need: PartDriverNeed, d: DriverFile): string {
  return `${need.key}|${d.source}->${d.target}`
}

/** A short human label for one driver row (its label, else the source). */
function driverLabel(d: DriverFile): string {
  return d.label?.trim() || d.source
}

export function DriverInstallBanner({ needs }: DriverInstallBannerProps): JSX.Element | null {
  const [dismissed, setDismissed] = useState(false)
  const [connected, setConnected] = useState(false)
  const [running, setRunning] = useState(false)
  // Per-driver status; absent ⇒ not started. Cleared when the part set changes.
  const [statuses, setStatuses] = useState<Record<string, DriverStatus>>({})
  // Driver rows already present on the board (keyed by driverKey). Probed on
  // connect, after an install, and when another window signals a change.
  const [present, setPresent] = useState<Set<string>>(new Set())
  const [probeNonce, setProbeNonce] = useState(0)

  // Track connection so Install is gated on a present board (it writes to it).
  useEffect(() => {
    let alive = true
    void window.api.device
      .getStatus()
      .then((s) => alive && setConnected(s?.state === 'connected'))
      .catch(() => undefined)
    const off = window.api.device.onStatus((s) => setConnected(s?.state === 'connected'))
    return () => {
      alive = false
      off()
    }
  }, [])

  // Reset progress if the set of parts-needing-drivers changes (different project
  // / placed part), so stale OK/error ticks never linger against new rows.
  const signature = needs.map((n) => n.key).join('|')
  useEffect(() => {
    setStatuses({})
    setDismissed(false)
  }, [signature])

  // Re-probe when ANY window installs a driver/library (our own install also bumps
  // the nonce below), so an install elsewhere clears rows here too.
  useEffect(() => window.api.modules.onChanged(() => setProbeNonce((n) => n + 1)), [])

  // Board-presence probe: stat each COPY driver's target file. mip drivers choose
  // their own on-device path (`/lib/<pkg>/…`), so we can't cheaply confirm them —
  // those always show. Any probe error ⇒ treat as absent (offer the install).
  useEffect(() => {
    if (!connected) {
      setPresent(new Set())
      return
    }
    let alive = true
    void (async (): Promise<void> => {
      const found = new Set<string>()
      for (const need of needs) {
        for (const d of need.drivers) {
          if (driverInstallMethod(d.source) !== 'copy') continue
          const target = d.target.trim()
          if (!target) continue
          const ok = await window.api.device
            .stat(target)
            .then(() => true)
            .catch(() => false)
          if (ok) found.add(driverKey(need, d))
        }
      }
      if (alive) setPresent(found)
    })()
    return () => {
      alive = false
    }
  }, [connected, signature, probeNonce])

  // The needs with already-present drivers filtered out (empty needs dropped).
  const visibleNeeds = useMemo(
    () =>
      needs
        .map((need) => ({
          ...need,
          drivers: need.drivers.filter((d) => !present.has(driverKey(need, d)))
        }))
        .filter((n) => n.drivers.length > 0),
    [needs, present]
  )

  if (visibleNeeds.length === 0 || dismissed) return null

  const setStatus = (id: string, status: DriverStatus): void =>
    setStatuses((prev) => ({ ...prev, [id]: status }))

  const installOne = async (need: PartDriverNeed, d: DriverFile): Promise<void> => {
    const id = driverKey(need, d)
    setStatus(id, { state: 'installing' })
    // The mip/copy sequence lives in the shared installer (also used by the main
    // editor's missing-library banner, #166) — this wrapper just maps to status.
    const res = await installPartDriver(need.libraryId, need.partId, d)
    setStatus(id, { state: res.ok ? 'ok' : 'error', message: res.message })
  }

  const installAll = async (): Promise<void> => {
    if (running || !connected) return
    setRunning(true)
    try {
      for (const need of visibleNeeds) {
        for (const d of need.drivers) {
          await installOne(need, d)
        }
      }
    } finally {
      setRunning(false)
      // Tell every window (incl. the main window's "missing library" banner) to
      // re-probe, and re-probe ourselves so freshly-installed rows drop out.
      window.api.modules.notifyChanged()
      setProbeNonce((n) => n + 1)
    }
  }

  const rows = visibleNeeds.flatMap((need) =>
    need.drivers.map((d) => ({ need, d, id: driverKey(need, d) }))
  )
  const total = rows.length
  const done = rows.filter(({ id }) => statuses[id]?.state === 'ok').length
  const errored = rows.some(({ id }) => statuses[id]?.state === 'error')
  const allOk = total > 0 && done === total

  return (
    <div className="drvbanner" role="region" aria-label="Driver install">
      <div className="drvbanner__head">
        <span className="drvbanner__icon" aria-hidden="true">
          {/* a small chip glyph */}
          <svg width="18" height="18" viewBox="0 0 24 24">
            <rect x="6" y="6" width="12" height="12" rx="2" fill="none" stroke="currentColor" strokeWidth="1.8" />
            <path
              d="M9 3v3M15 3v3M9 18v3M15 18v3M3 9h3M3 15h3M18 9h3M18 15h3"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
            />
          </svg>
        </span>
        <div className="drvbanner__text">
          <strong className="drvbanner__title">
            {allOk
              ? 'Drivers installed'
              : `${visibleNeeds.length} part${visibleNeeds.length === 1 ? '' : 's'} need${
                  visibleNeeds.length === 1 ? 's' : ''
                } a driver`}
          </strong>
          <span className="drvbanner__sub">
            {allOk
              ? 'All driver files are on the board.'
              : connected
                ? 'Copy the required MicroPython driver file(s) onto the connected board.'
                : 'Connect a board to install the required driver file(s).'}
          </span>
        </div>
        <div className="drvbanner__actions">
          {!allOk && (
            <button
              type="button"
              className="drvbanner__install"
              onClick={() => void installAll()}
              disabled={running || !connected}
              title={connected ? 'Install the drivers onto the board' : 'Connect a board first'}
            >
              {running ? `Installing… ${done}/${total}` : errored ? 'Retry install' : 'Install drivers'}
            </button>
          )}
          <button
            type="button"
            className="drvbanner__dismiss"
            onClick={() => setDismissed(true)}
            aria-label="Dismiss driver prompt"
            title="Dismiss"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="1.9" />
            </svg>
          </button>
        </div>
      </div>

      <ul className="drvbanner__list">
        {rows.map(({ need, d, id }) => {
          const st = statuses[id]?.state ?? 'pending'
          return (
            <li key={id} className={`drvbanner__row drvbanner__row--${st}`}>
              <span className={`drvbanner__dot drvbanner__dot--${st}`} aria-hidden="true" />
              <span className="drvbanner__row-part">{need.label}</span>
              <span className="drvbanner__row-driver">{driverLabel(d)}</span>
              <span className="drvbanner__row-target" title={`Installs to ${d.target}`}>
                → {d.target}
              </span>
              {st === 'error' && statuses[id]?.message && (
                <span className="drvbanner__row-error">{statuses[id]?.message}</span>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
