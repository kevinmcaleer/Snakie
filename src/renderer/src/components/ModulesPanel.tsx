import { useCallback, useEffect, useMemo, useState } from 'react'
import './ModulesPanel.css'
import { useDeviceStatus } from '../hooks/useDeviceStatus'
import {
  groupByInstrument,
  MODULES,
  type InstrumentId,
  type ModuleDef
} from '../../../shared/modules-catalog'
import {
  buildRowStatuses,
  countStatuses,
  rowAction,
  type ModuleInstallUiState
} from '../lib/modulesManager'
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
 * process resolves a per-module install plan (a bundled `.py`'s contents, or a
 * `mip` snippet) and the install runs over the existing serialized device
 * channel. Already-installed detection is a cheap `import <name>` probe on the
 * board (`probeInstalled`) — re-run on connect + after each install.
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
  gamepad: 'Gamepad / Teleop'
}

export function ModulesPanel(): JSX.Element {
  const status = useDeviceStatus()
  const connected = status.state === 'connected'

  // The set of import-names found present on the board (the probe result). Empty
  // until/unless a probe runs; reset on disconnect.
  const [installedNames, setInstalledNames] = useState<ReadonlySet<string>>(new Set())
  const [probing, setProbing] = useState(false)

  // Per-module in-flight install transitions, keyed by catalog id.
  const [installs, setInstalls] = useState<Record<string, ModuleInstallUiState>>({})

  const installDone = Object.values(installs).filter((s) => s.status === 'done').length

  // Probe the board for already-installed modules: on connect, and after each
  // successful install. Tolerant of any device error (clears to empty set).
  useEffect(() => {
    if (!connected) {
      setInstalledNames(new Set())
      return
    }
    let active = true
    setProbing(true)
    const names = MODULES.map((m) => m.importName)
    window.api.modules
      .probeInstalled(names)
      .then((found) => {
        if (active) setInstalledNames(new Set(found))
      })
      .catch(() => {
        if (active) setInstalledNames(new Set())
      })
      .finally(() => {
        if (active) setProbing(false)
      })
    return () => {
      active = false
    }
  }, [connected, installDone])

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

  const groups = useMemo(() => groupByInstrument(), [])
  const statuses = useMemo(
    () => buildRowStatuses(MODULES, installedNames, connected, installs),
    [installedNames, connected, installs]
  )
  const counts = useMemo(() => countStatuses(MODULES, statuses), [statuses])

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
          title={connected ? `Install ${def.name}` : 'Connect a board first'}
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
            <span className="mods__src">
              {def.source.kind === 'bundled' ? `bundled · ${def.license ?? 'stub'}` : 'mip'}
            </span>
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
          You can still browse the catalog below.
        </p>
      )}

      {groups.map((group) => (
        <section key={group.instrument} className="mods__group">
          <div className="mods__group-head">
            {INSTRUMENT_TITLES[group.instrument] ?? group.instrument}
          </div>
          <ul className="mods__list" role="list">
            {group.modules.map(renderTag)}
          </ul>
        </section>
      ))}
    </div>
  )
}
