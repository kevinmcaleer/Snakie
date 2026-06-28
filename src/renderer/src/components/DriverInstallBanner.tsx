import { useEffect, useState } from 'react'
import {
  driverDeviceDirs,
  driverInstallMethod,
  type PartDriverNeed
} from './part-editor.util'
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
 * Installing touches the device, so the action is disabled until a board is
 * connected (mirrors the SAM instrument's "is the board connected?" guard).
 */

/** Per-driver install state, keyed by `<need.key>#<driverIndex>`. */
type DriverState = 'pending' | 'installing' | 'ok' | 'error'
interface DriverStatus {
  state: DriverState
  message?: string
}

export interface DriverInstallBannerProps {
  /** The placed parts that declare drivers (from `placedPartsNeedingDrivers`). */
  needs: PartDriverNeed[]
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

  if (needs.length === 0 || dismissed) return null

  const setStatus = (id: string, status: DriverStatus): void =>
    setStatuses((prev) => ({ ...prev, [id]: status }))

  const installOne = async (need: PartDriverNeed, index: number, d: DriverFile): Promise<void> => {
    const id = `${need.key}#${index}`
    setStatus(id, { state: 'installing' })
    try {
      if (driverInstallMethod(d.source) === 'mip') {
        const target = d.target.trim()
        const res = await window.api.packages.install(
          d.source,
          target ? { target } : undefined
        )
        setStatus(id, {
          state: res.ok ? 'ok' : 'error',
          message: res.ok ? undefined : res.log.split('\n').filter(Boolean).pop() || 'mip failed'
        })
        return
      }
      // copy: read the file (bundled file or URL, via main) then write to target.
      const read = await window.api.parts.readDriverSource(need.libraryId, need.partId, d.source)
      if (!read.ok || read.contents == null) {
        setStatus(id, { state: 'error', message: read.error || 'Could not read driver file.' })
        return
      }
      // MicroPython has no recursive mkdir — create each ancestor folder in turn
      // (an "already exists" error is fine, so we swallow it).
      for (const dir of driverDeviceDirs(d.target)) {
        await window.api.device.mkdir(dir).catch(() => undefined)
      }
      await window.api.device.writeFile(d.target.trim(), read.contents)
      setStatus(id, { state: 'ok' })
    } catch (err) {
      setStatus(id, { state: 'error', message: err instanceof Error ? err.message : String(err) })
    }
  }

  const installAll = async (): Promise<void> => {
    if (running || !connected) return
    setRunning(true)
    try {
      for (const need of needs) {
        for (let i = 0; i < need.drivers.length; i++) {
          await installOne(need, i, need.drivers[i])
        }
      }
    } finally {
      setRunning(false)
    }
  }

  const total = needs.reduce((n, need) => n + need.drivers.length, 0)
  const done = Object.values(statuses).filter((s) => s.state === 'ok').length
  const errored = Object.values(statuses).some((s) => s.state === 'error')
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
              : `${needs.length} part${needs.length === 1 ? '' : 's'} need${
                  needs.length === 1 ? 's' : ''
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
        {needs.map((need) =>
          need.drivers.map((d, i) => {
            const id = `${need.key}#${i}`
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
          })
        )}
      </ul>
    </div>
  )
}
