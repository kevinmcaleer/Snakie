import { useCallback, useEffect, useMemo, useState } from 'react'
import './ModulesPanel.css'
import { useDeviceStatus } from '../hooks/useDeviceStatus'
import {
  groupByInstrument,
  MODULES,
  modulesForDialect,
  type InstrumentId,
  type ModuleDef
} from '../../../shared/modules-catalog'
import { DIALECT_LABEL } from '../../../shared/dialect'
import {
  buildRowStatuses,
  countStatuses,
  rowAction,
  type ModuleInstallUiState
} from '../lib/modulesManager'
import { probeOutdatedModules } from '../lib/moduleFreshness'
import type { ModuleInstallProgress } from '../../../preload/index.d'

/**
 * MODULES MANAGER (issue #120)
 * ============================
 *
 * The "Make Snakie modular" UI: install ONLY the driver behind the instrument a
 * robot uses, rather than every driver. The catalog (`src/shared/modules-catalog`)
 * is grouped BY INSTRUMENT (Range, IMU, LED, …) so it reads as "what powers each
 * dock panel"; each module shows INSTALLED vs AVAILABLE and installs with
 * progress + inline errors.
 *
 * Mechanism (all via `window.api.modules`, mirroring the Packages tab): the main
 * process resolves a per-module install plan — a bundled `.py`'s contents, or an
 * upstream package downloaded there (#776) — and the files are written over the
 * existing serialized device channel. Already-installed detection is a cheap
 * `import <name>` probe on the board (`probeInstalled`) — re-run on connect +
 * after each install.
 *
 * Hardware can't be exercised in CI, so every async path degrades gracefully:
 * the probe falls back to "available" when disconnected, and installs surface
 * device errors inline rather than throwing.
 *
 * VISUALS: reuses the Packages tab's skeuomorph "manila tags on green felt" kit
 * (kraft spine, silver eyelet, gold-key INSTALL / green INSTALLED stamp), with
 * one felt section per instrument group.
 */

/** Friendly section titles for each instrument group (keeps the UI label-driven). */
const INSTRUMENT_TITLES: Record<InstrumentId, string> = {
  'i2c-display': 'I²C Display',
  range: 'Range',
  imu: 'IMU',
  led: 'LED',
  encoder: 'Encoder',
  buzzer: 'Buzzer',
  gamepad: 'Gamepad / Teleop',
  motor: 'Motor Driver'
}

/** What the source badge on a row says, per source kind (#758). */
function sourceLabel(def: ModuleDef): string {
  if (def.source.kind === 'bundled') return `bundled · ${def.license ?? 'stub'}`
  if (def.source.kind === 'bundle') return 'Adafruit bundle'
  return 'mip'
}

export function ModulesPanel(): JSX.Element {
  const status = useDeviceStatus()
  const connected = status.state === 'connected'
  // Which runtime the board is running (#752). It decides which HALF of the
  // catalog is shown: a MicroPython board can't import an Adafruit `.mpy`, and a
  // CircuitPython board can't run a `machine`-based stub, so offering either the
  // other's drivers would be an INSTALL button that could only ever fail (#758).
  const dialect = connected ? status.runtime?.dialect : undefined
  const catalog = useMemo(() => modulesForDialect(dialect, MODULES), [dialect])

  // The set of import-names found present on the board (the probe result). Empty
  // until/unless a probe runs; reset on disconnect.
  const [installedNames, setInstalledNames] = useState<ReadonlySet<string>>(new Set())
  // The subset of those whose /lib copy read back STALE against the shipped
  // version (#707) — their rows offer UPDATE instead of the INSTALLED stamp.
  const [outdatedNames, setOutdatedNames] = useState<ReadonlySet<string>>(new Set())
  const [probing, setProbing] = useState(false)

  // Per-module in-flight install transitions, keyed by catalog id.
  const [installs, setInstalls] = useState<Record<string, ModuleInstallUiState>>({})

  const installDone = Object.values(installs).filter((s) => s.status === 'done').length

  // Probe the board for already-installed modules: on connect, and after each
  // successful install. A bundled module found importable is then checked for
  // FRESHNESS against the shipped version (#707) — presence alone let a stale
  // driver read as installed for ever. Tolerant of any device error (clears to
  // empty sets).
  useEffect(() => {
    if (!connected) {
      setInstalledNames(new Set())
      setOutdatedNames(new Set())
      return
    }
    let active = true
    setProbing(true)
    const names = catalog.map((m) => m.importName)
    void (async (): Promise<void> => {
      try {
        const found = new Set(await window.api.modules.probeInstalled(names))
        const stale = await probeOutdatedModules(
          catalog.filter((m) => found.has(m.importName))
        ).catch(() => new Set<string>())
        if (active) {
          setInstalledNames(found)
          setOutdatedNames(stale)
        }
      } catch {
        if (active) {
          setInstalledNames(new Set())
          setOutdatedNames(new Set())
        }
      } finally {
        if (active) setProbing(false)
      }
    })()
    return () => {
      active = false
    }
  }, [catalog, connected, installDone])

  const install = useCallback(async (def: ModuleDef): Promise<void> => {
    setInstalls((prev) => ({
      ...prev,
      [def.id]: { status: 'installing', log: '', notes: [] }
    }))
    const collected: string[] = []
    const onProgress = (p: ModuleInstallProgress): void => {
      if (p.state === 'note' && p.message) collected.push(p.message)
    }
    try {
      const result = await window.api.modules.install(def.id, onProgress)
      setInstalls((prev) => ({
        ...prev,
        [def.id]: {
          status: result.ok ? 'done' : 'error',
          log: result.log,
          notes: result.notes.length ? result.notes : collected
        }
      }))
    } catch (err) {
      setInstalls((prev) => ({
        ...prev,
        [def.id]: {
          status: 'error',
          log: err instanceof Error ? err.message : String(err),
          notes: collected
        }
      }))
    }
  }, [])

  const groups = useMemo(() => groupByInstrument(catalog), [catalog])
  const statuses = useMemo(
    () => buildRowStatuses(catalog, installedNames, connected, installs, outdatedNames),
    [catalog, installedNames, connected, installs, outdatedNames]
  )
  const counts = useMemo(() => countStatuses(catalog, statuses), [catalog, statuses])

  const renderTag = (def: ModuleDef): JSX.Element => {
    const st = statuses[def.id] ?? 'available'
    const ui = installs[def.id]
    const { label, actionable } = rowAction(st)
    const action =
      st === 'installed' ? (
        <span className="mods__stamp mods__stamp--installed">INSTALLED</span>
      ) : (
        <button
          type="button"
          className="mods__key"
          disabled={!connected || st === 'installing'}
          title={
            connected
              ? st === 'outdated'
                ? `An older copy of ${def.name} is on the board — update it`
                : `Install ${def.name}`
              : 'Connect a board first'
          }
          onClick={() => void install(def)}
        >
          {actionable && !connected ? 'INSTALL' : label}
        </button>
      )
    return (
      <li key={def.id} className="mods__tag">
        <span className="mods__tag-spine" aria-hidden="true" />
        <span className="mods__tag-eyelet" aria-hidden="true" />
        <div className="mods__tag-body">
          <div className="mods__tag-head">
            <span className="mods__name">{def.name}</span>
            <span className="mods__import">import {def.importName}</span>
          </div>
          <p className="mods__desc">{def.description}</p>
          {ui && (ui.notes.length > 0 || ui.log) && (
            <div className="mods__result">
              {ui.notes.map((n, i) => (
                <p key={i} className="mods__note">
                  {n}
                </p>
              ))}
              {ui.log && (
                <pre className={`mods__log${ui.status === 'error' ? ' mods__log--error' : ''}`}>
                  {ui.log}
                </pre>
              )}
            </div>
          )}
          <div className="mods__tag-foot">
            <span className="mods__src">{sourceLabel(def)}</span>
            {action}
          </div>
        </div>
      </li>
    )
  }

  return (
    <div className="mods">
      <div className="mods__header">
        <span className="mods__title">MODULES</span>
        <span className="mods__count">
          {connected ? `${counts.installed} / ${counts.total} ON BOARD` : '— / — ON BOARD'}
        </span>
      </div>

      <p className="mods__blurb">
        Install only the drivers your robot needs — pick the module behind each
        instrument. {probing && <span className="mods__probing">checking board…</span>}
      </p>

      {!connected && (
        <p className="mods__hint" role="status">
          Connect a board to install modules and detect what&rsquo;s already on it.
          You can still browse the catalog below — for both MicroPython and CircuitPython.
        </p>
      )}

      {/* Say WHY the list got shorter. Silently hiding half the catalog when a
          board connects would read as a bug; naming the runtime and where its
          libraries come from turns it into an explanation (#758). */}
      {connected && dialect && dialect !== 'unknown' && (
        <p className="mods__hint mods__hint--dialect" role="status">
          Showing <strong>{DIALECT_LABEL[dialect]}</strong> drivers, because that is what this
          board runs.{' '}
          {dialect === 'circuitpython'
            ? 'They come from the Adafruit CircuitPython Library Bundle, matched to the board’s CircuitPython version.'
            : 'CircuitPython’s Adafruit-bundle libraries won’t import here, so they are hidden.'}
        </p>
      )}

      {groups.map((group) => (
        <section key={group.instrument ?? 'other'} className="mods__group">
          <div className="mods__group-head">
            {/* A module with no instrument is a real driver with no panel behind
                it (an RTC, an SD card) — grouped honestly rather than filed under
                an unrelated instrument. */}
            {group.instrument
              ? (INSTRUMENT_TITLES[group.instrument] ?? group.instrument)
              : 'Other drivers'}
          </div>
          <ul className="mods__list" role="list">
            {group.modules.map(renderTag)}
          </ul>
        </section>
      ))}
    </div>
  )
}
