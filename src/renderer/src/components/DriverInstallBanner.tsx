import { useEffect, useMemo, useState } from 'react'
import { driverInstallMethod, driverModuleId, type PartDriverNeed } from './part-editor.util'
import { moduleById, type ModuleDef } from '../../../shared/modules-catalog'
import { probeOutdatedModules } from '../lib/moduleFreshness'
import { installPartDriver } from './driver-install'
import { Notice } from './Notice'
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
 *             its `target` path with `device.writeFile`;
 *  - `module` → a `module:<id>` reference into the MODULES CATALOG (#638),
 *             installed exactly as the Modules panel does. Lets a part require a
 *             driver Snakie already ships without copying the `.py` into every
 *             part folder that needs it.
 *
 * The banner is BOARD-AWARE: it stats each `copy` driver's target, and probes each
 * `module` driver BY IMPORT (a mip-backed module lands wherever mip decides, so a
 * guessed path would never match and the banner would nag for ever), showing the
 * drivers that are MISSING — plus, for bundled catalog modules, the ones whose
 * `/lib` copy is OUTDATED against the shipped version (#707: presence alone let a
 * stale driver read as installed for ever, so a bug-fixed driver could never
 * reach a board that already had the old one). Rows clear once installed /
 * updated (its own install, or another window's, via the shared
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
  // Driver rows already present AND current on the board (keyed by driverKey).
  // Probed on connect, after an install, and when another window signals a change.
  const [present, setPresent] = useState<Set<string>>(new Set())
  // Rows whose /lib copy read back STALE against the shipped version (#707) —
  // still shown, worded as an update rather than an install.
  const [outdated, setOutdated] = useState<Set<string>>(new Set())
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
      setOutdated(new Set())
      return
    }
    let alive = true
    void (async (): Promise<void> => {
      const found = new Set<string>()
      const stale = new Set<string>()
      // Catalog-module drivers are probed by IMPORT, not by path: a `mip`-backed
      // module (e.g. my9221) lands wherever mip decides, so stat-ing a guessed
      // target would never find it and the banner would nag for ever.
      const modNeeds: { key: string; def: ModuleDef }[] = []
      for (const need of needs) {
        for (const d of need.drivers) {
          const method = driverInstallMethod(d.source)
          if (method === 'module') {
            const def = moduleById(driverModuleId(d.source))
            if (def) modNeeds.push({ key: driverKey(need, d), def })
            continue
          }
          if (method !== 'copy') continue
          const target = d.target.trim()
          if (!target) continue
          const ok = await window.api.device
            .stat(target)
            .then(() => true)
            .catch(() => false)
          if (ok) found.add(driverKey(need, d))
        }
      }
      if (modNeeds.length) {
        const importable = new Set(
          await window.api.modules
            .probeInstalled(modNeeds.map((m) => m.def.importName))
            .catch(() => [])
        )
        // Importable is not the same as CURRENT (#707): check each importable
        // bundled module's /lib copy against the catalog-declared version, so a
        // stale driver is offered as an update instead of reading as done.
        // (Deduped by import-name — two parts needing one module probe it once.)
        const importableDefs = [
          ...new Map(
            modNeeds
              .filter((m) => importable.has(m.def.importName))
              .map((m) => [m.def.importName, m.def])
          ).values()
        ]
        const outdatedNames = await probeOutdatedModules(importableDefs).catch(
          () => new Set<string>()
        )
        for (const m of modNeeds) {
          if (!importable.has(m.def.importName)) continue
          if (outdatedNames.has(m.def.importName)) stale.add(m.key)
          else found.add(m.key)
        }
      }
      if (alive) {
        setPresent(found)
        setOutdated(stale)
      }
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
  // Every visible row is an update (#707) ⇒ word the banner as one — "needs a
  // driver" on a board that HAS the driver reads as a false alarm.
  const allStale = total > 0 && rows.every(({ id }) => outdated.has(id))

  // The summary must carry WHY Install is disabled, or a greyed-out button reads
  // as broken rather than blocked.
  const one = visibleNeeds.length === 1
  const summary = allOk
    ? 'Drivers installed'
    : allStale
      ? `${visibleNeeds.length} part${one ? '' : 's'} ha${one ? 's' : 've'} a driver update${
          connected ? '' : ' — connect a board'
        }`
      : `${visibleNeeds.length} part${one ? '' : 's'} need${one ? 's' : ''} a driver${
          connected ? '' : ' — connect a board'
        }`

  return (
    <Notice
      variant="canvas"
      tone={errored ? 'error' : 'info'}
      summary={summary}
      // An install failure must not stay hidden behind a collapsed row — the
      // message is the only thing that explains what to do next.
      forceExpanded={errored}
      action={
        allOk
          ? undefined
          : {
              label: running
                ? `Installing… ${done}/${total}`
                : errored
                  ? 'Retry install'
                  : allStale
                    ? 'Update drivers'
                    : 'Install drivers',
              onClick: () => void installAll(),
              disabled: running || !connected,
              title: connected
                ? allStale
                  ? 'Update the drivers on the board'
                  : 'Install the drivers onto the board'
                : 'Connect a board first'
            }
      }
      onDismiss={() => setDismissed(true)}
      detail={
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
                {outdated.has(id) && (
                  <span
                    className="drvbanner__row-stale"
                    title="An older copy of this driver is on the board — installing updates it"
                  >
                    update
                  </span>
                )}
                {st === 'error' && statuses[id]?.message && (
                  <span className="drvbanner__row-error">{statuses[id]?.message}</span>
                )}
              </li>
            )
          })}
        </ul>
      }
    />
  )
}
