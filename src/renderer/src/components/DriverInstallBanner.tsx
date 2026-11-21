import { useEffect, useMemo, useRef, useState } from 'react'
import { driverInstallMethod, driverModuleId, type PartDriverNeed } from './part-editor.util'
import { moduleById, type ModuleDef } from '../../../shared/modules-catalog'
import { probeOutdatedModules } from '../lib/moduleFreshness'
import { installPartDriver } from './driver-install'
import { Notice } from './Notice'
import { dispatchDeviceAction } from './device-bus'
import type { DriverFile } from '../../../preload/index.d'
import type { RequiredModule } from './part-imports'
import './ErcPanel.css'
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
 * Per driver, the install mechanism is chosen by {@link driverInstallMethod}.
 * All three end in files written to the board — since #776 nothing is fetched
 * BY the board, which has no internet connection of its own:
 *  - `mip`  → `window.api.packages.install(source, { target })` (a github:/pypi:
 *             spec or a bare micropython-lib package name), downloaded in main;
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
 * `module` driver BY IMPORT (an upstream package lands wherever its own
 * `package.json` puts it, so a guessed path would never match and the banner
 * would nag for ever), showing the
 * drivers that are MISSING — plus, for bundled catalog modules, the ones whose
 * `/lib` copy is OUTDATED against the shipped version (#707: presence alone let a
 * stale driver read as installed for ever, so a bug-fixed driver could never
 * reach a board that already had the old one). Rows clear once installed /
 * updated (its own install, or another window's, via the shared
 * `modules.onChanged` signal), instead of lingering forever.
 *
 * Installing touches the device, but the action is NEVER greyed out for want of
 * one: pressing it with no board asks the connection control to connect, says
 * what is missing in plain words, and installs as soon as a board arrives.
 */

/** Per-driver install state, keyed by {@link driverKey}. */
type DriverState = 'pending' | 'installing' | 'ok' | 'error'
interface DriverStatus {
  state: DriverState
  message?: string
  /** Said on SUCCESS when the board was still holding a stale copy of this
   *  module and Snakie dropped it (#784). Kept separate from `message`, which
   *  is a failure reason — this row succeeded, and the note explains something
   *  that happened along the way rather than something that went wrong. */
  note?: string
}

/**
 * The project-parts check for the OPEN FILE (#166), owned by AppShell: modules
 * the placed parts need that this file doesn't import, and libraries the board
 * hasn't got. It used to be its own full-width banner above the whole app; it
 * rides in the same chip now, so the editor has ONE place for "your parts need
 * something" and nothing pushes the content down.
 */
export interface PartsNotice {
  /** Required modules the active file doesn't import. */
  missingImports: RequiredModule[]
  /** Required modules not importable on the connected board. */
  missingOnBoard: RequiredModule[]
  installing: boolean
  error?: string | null
  /** Install the missing board libraries (driver files copy; `url` ones via mip). */
  onInstall: () => void
}

export interface DriverInstallBannerProps {
  /** The placed parts that declare drivers (from `placedPartsNeedingDrivers`). */
  needs: PartDriverNeed[]
  /**
   * `banner` (default): a full-width Notice row above the content — the Blocks
   * workspace. `chip`: a compact "Drivers" chip for the code editor's tab strip,
   * beside Find, that opens a small card OVER the code. A full-width row pushed
   * the content down for something that is only actionable once a board is
   * plugged in, so the Code workspace never uses one.
   */
  layout?: 'banner' | 'chip'
  /** Chip only: open the Electronics workspace, where the parts are placed.
   *  Absent ⇒ no such button. */
  onShowParts?: () => void
  /** Chip only: the open file's parts check (see {@link PartsNotice}). */
  parts?: PartsNotice
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

export function DriverInstallBanner({
  needs,
  layout = 'banner',
  onShowParts,
  parts
}: DriverInstallBannerProps): JSX.Element | null {
  const chip = layout === 'chip'
  const [dismissed, setDismissed] = useState(false)
  // Chip layout only: where the card is showing, or null when it's closed. Fixed
  // to the viewport and clamped inside it: on a phone the chip sits mid-strip,
  // and a card anchored to its right edge ran off the left of the screen.
  const [popPos, setPopPos] = useState<{ top: number; right: number; width: number } | null>(
    null
  )
  const popOpen = popPos !== null
  const chipRef = useRef<HTMLDivElement>(null)
  // The card closes like any popover: a press outside it, or Escape. It also
  // closes on resize, where its fixed position would go stale.
  useEffect(() => {
    if (!popOpen) return
    const close = (): void => setPopPos(null)
    const onDown = (e: PointerEvent): void => {
      if (!chipRef.current?.contains(e.target as Node)) close()
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('pointerdown', onDown, true)
    window.addEventListener('keydown', onKey)
    window.addEventListener('resize', close)
    return () => {
      window.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', close)
    }
  }, [popOpen])
  const setPopOpen = (open: boolean): void => {
    if (!open) setPopPos(null)
  }
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
  // Install was pressed with no board connected: we asked for a connection and
  // will install the moment one arrives. Drives the "connect your board" line.
  const [waitingForBoard, setWaitingForBoard] = useState(false)
  // The latest installAll, for the effect below (it is defined after the early
  // return, where hooks cannot live).
  const installRef = useRef<() => Promise<void>>(async () => undefined)

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

  // The board arrived after Install was pressed — carry on with the install the
  // user already asked for, rather than making them press it twice.
  useEffect(() => {
    if (!waitingForBoard || !connected) return
    setWaitingForBoard(false)
    void installRef.current()
  }, [waitingForBoard, connected])

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

  // The parts check's board libraries that the driver rows don't already cover:
  // a part that ships driver files is a driver row above (and its module is the
  // same file), so only modules with nothing but a mip source are left over.
  const extraLibs = chip ? (parts?.missingOnBoard ?? []).filter((m) => !(m.drivers?.length ?? 0)) : []
  const installableExtra = extraLibs.filter((m) => m.url)
  const missingImports = chip ? (parts?.missingImports ?? []) : []

  // A chip is already out of the way, so it never dismisses — ✕ closes its popover.
  if (
    (visibleNeeds.length === 0 && extraLibs.length === 0 && missingImports.length === 0) ||
    (dismissed && !chip)
  )
    return null

  const setStatus = (id: string, status: DriverStatus): void =>
    setStatuses((prev) => ({ ...prev, [id]: status }))

  const installOne = async (need: PartDriverNeed, d: DriverFile): Promise<boolean> => {
    const id = driverKey(need, d)
    setStatus(id, { state: 'installing' })
    // The mip/copy sequence lives in the shared installer (also used by the main
    // editor's missing-library banner, #166) — this wrapper just maps to status.
    const res = await installPartDriver(need.libraryId, need.partId, d)
    setStatus(id, { state: res.ok ? 'ok' : 'error', message: res.message, note: res.note })
    return !res.cancelled
  }

  const installAll = async (): Promise<void> => {
    if (running) return
    if (!connected) {
      // Never a dead button: ask whoever owns the connection to connect the
      // selected port, and install once it is up (the effect above).
      setWaitingForBoard(true)
      dispatchDeviceAction('connect')
      return
    }
    setRunning(true)
    try {
      // A row that fails does NOT stop the run — installing what can be
      // installed is the useful behaviour. A CANCEL does (#837): the user asked
      // for the board to be left alone, and queueing the next driver behind
      // their cancel would be answering a different question.
      for (const need of visibleNeeds) {
        for (const d of need.drivers) {
          if (!(await installOne(need, d))) return
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

  // The chip's one Install: the driver rows, then any leftover mip libraries.
  const installEverything = async (): Promise<void> => {
    await installAll()
    if (connected && installableExtra.length > 0 && !parts?.installing) parts?.onInstall()
  }
  installRef.current = installEverything

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

  const one = visibleNeeds.length === 1
  const summary = allOk
    ? 'Drivers installed'
    : allStale
      ? `${visibleNeeds.length} part${one ? '' : 's'} ha${one ? 's' : 've'} a driver update`
      : `${visibleNeeds.length} part${one ? '' : 's'} need${one ? 's' : ''} a driver`
  const actionLabel = running
    ? `Installing… ${done}/${total}`
    : errored
      ? 'Retry install'
      : allStale
        ? 'Update drivers'
        : 'Install drivers'
  // Shown once Install was pressed without a board: what is missing, in words.
  const boardHint = waitingForBoard && !connected
    ? 'Connect your board to install. Plug it in and pick it in the console bar; the install starts as soon as it connects.'
    : null

  const list = (
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
            {/* A successful install that ALSO had to clear the board's
                cached copy (#784). Without this the banner reports plain
                success while something the user never asked about was
                changed on their board — and the import that sent them here
                would still have been failing for a reason nothing named. */}
            {st === 'ok' && statuses[id]?.note && (
              <span className="drvbanner__row-note">{statuses[id]?.note}</span>
            )}
          </li>
        )
      })}
    </ul>
  )

  if (!chip) {
    return (
      <Notice
        variant="canvas"
        tone={errored ? 'error' : 'info'}
        summary={summary}
        // An install failure must not stay hidden behind a collapsed row — the
        // message is the only thing that explains what to do next. Nor may the
        // "connect your board" line, which answers the press that showed it.
        forceExpanded={errored || !!boardHint}
        action={
          allOk
            ? undefined
            : {
                label: actionLabel,
                onClick: () => void installAll(),
                disabled: running,
                title: allStale ? 'Update the drivers on the board' : 'Install the drivers onto the board'
              }
        }
        onDismiss={() => setDismissed(true)}
        detail={
          <>
            {boardHint && <p className="drvbanner__hint">{boardHint}</p>}
            {list}
          </>
        }
      />
    )
  }

  // The code editor's chip (beside Find): amber while something needs
  // installing, red after a failure, green once everything is in. Its card hangs
  // OVER the code — nothing in the editor moves when it opens.
  const libsBusy = !!parts?.installing
  const libsError = parts?.error ?? null
  const anyErrored = errored || !!libsError
  // What still needs installing: driver rows not yet in, plus leftover libraries.
  const toInstall = total - done + extraLibs.length
  const everythingIn = toInstall === 0 && (allOk || total === 0)
  const onlyImports = toInstall === 0 && total === 0
  const tone = anyErrored ? 'error' : onlyImports ? 'warning' : everythingIn ? 'ok' : 'warning'
  const count = onlyImports ? missingImports.length : toInstall
  const listNames = (ms: RequiredModule[]): string => ms.map((m) => m.module).join(', ')
  const title =
    total > 0
      ? summary
      : extraLibs.length > 0
        ? `The board is missing ${extraLibs.length === 1 ? 'a library' : `${extraLibs.length} libraries`}`
        : `This file doesn't import ${listNames(missingImports)}`
  const installLabel =
    total > 0 && !allOk
      ? actionLabel
      : libsBusy
        ? 'Installing…'
        : libsError
          ? 'Retry install'
          : `Install ${installableExtra.length === 1 ? installableExtra[0].module : `${installableExtra.length} libraries`}`
  const showInstall = (total > 0 && !allOk) || installableExtra.length > 0
  return (
    <div className="drvchip" ref={chipRef}>
      <button
        type="button"
        className={`drvchip__btn drvchip__btn--${tone}${popOpen ? ' is-open' : ''}`}
        onClick={(e) => {
          if (popOpen) return setPopOpen(false)
          const r = e.currentTarget.getBoundingClientRect()
          const width = Math.min(340, window.innerWidth - 24)
          const right = Math.min(Math.max(12, window.innerWidth - r.right), window.innerWidth - 12 - width)
          setPopPos({ top: r.bottom + 6, right, width })
        }}
        aria-expanded={popOpen}
        aria-haspopup="dialog"
        title={`${title} — click for details`}
      >
        <span className="drvchip__dot" aria-hidden="true" />
        {onlyImports ? 'Imports' : 'Drivers'}
        {everythingIn && !onlyImports ? (
          <span className="drvchip__count drvchip__count--ok" aria-hidden="true">
            ✓
          </span>
        ) : (
          <span className="drvchip__count">{count}</span>
        )}
      </button>
      {popOpen && (
        <div
          className={`drvchip__pop drvchip__pop--${tone}`}
          role="dialog"
          aria-label="Part drivers and libraries"
          style={popPos ?? undefined}
        >
          <div className="drvchip__head">
            <span className="drvchip__dot" aria-hidden="true" />
            <h4 className="drvchip__title">{title}</h4>
            <button
              type="button"
              className="drvchip__close"
              onClick={() => setPopOpen(false)}
              aria-label="Close"
              title="Close"
            >
              ✕
            </button>
          </div>
          {total > 0 && !allOk && (
            <p className="drvchip__text">
              {allStale
                ? 'An older copy is on the board. Update it so your code gets the fixed version.'
                : one
                  ? `Your code can't use the ${visibleNeeds[0].label} until its driver is on the board.`
                  : "Your code can't use these parts until their drivers are on the board."}
            </p>
          )}
          {boardHint && <p className="drvchip__hint">{boardHint}</p>}
          {total > 0 && list}
          {extraLibs.length > 0 && (
            <ul className="drvbanner__list">
              {extraLibs.map((m) => (
                <li key={m.module} className="drvbanner__row drvbanner__row--pending">
                  <span className="drvbanner__dot drvbanner__dot--pending" aria-hidden="true" />
                  <span className="drvbanner__row-part">{m.module}</span>
                  <span className="drvbanner__row-driver">for {m.parts.join(', ')}</span>
                  {!m.url && (
                    <span className="drvbanner__row-error">
                      Snakie doesn&rsquo;t know where to get this one. Copy it into /lib on the board.
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
          {libsError && <p className="drvchip__hint">Couldn&rsquo;t install: {libsError}</p>}
          {missingImports.length > 0 && (
            <p className="drvchip__text">
              {total > 0 || extraLibs.length > 0 ? 'Also, this file ' : 'This file '}
              doesn&rsquo;t <code>import</code> <strong>{listNames(missingImports)}</strong> yet (needed by{' '}
              {[...new Set(missingImports.flatMap((m) => m.parts))].join(', ')}). Add the import when
              your code uses {missingImports.length === 1 ? 'that part' : 'those parts'}.
            </p>
          )}
          <div className="drvchip__actions">
            {showInstall && (
              <button
                type="button"
                className="drvchip__primary"
                onClick={() => void installEverything()}
                disabled={running || libsBusy}
              >
                {installLabel}
              </button>
            )}
            {onShowParts && (
              <button
                type="button"
                className="drvchip__secondary"
                onClick={() => {
                  setPopOpen(false)
                  onShowParts()
                }}
              >
                Show parts
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
