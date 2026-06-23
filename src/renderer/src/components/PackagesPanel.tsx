import { useCallback, useEffect, useMemo, useState } from 'react'
import './PackagesPanel.css'
import { useDeviceStatus } from '../hooks/useDeviceStatus'
import { ModulesPanel } from './ModulesPanel'
import type { InstallProgress, PackageInfo } from '../../../preload/index.d'

/**
 * PACKAGES TAB (issue #20)
 * ========================
 *
 * In-app MicroPython package installer, driven by the feedback in
 * docs/feedback.md: keep search front-and-centre, offer discovery of popular
 * libraries, expose advanced options (overwrite / custom index URL / .mpy), and
 * NEVER kick the user out to another app.
 *
 * Network access (PyPI search + discovery) is brokered by the main process
 * (`window.api.packages`) because the renderer CSP forbids outbound requests.
 * Installs run MicroPython's `mip` on the connected board, so the install
 * controls are gated on an active connection with a clear hint otherwise.
 *
 * Hardware + network can't be exercised in CI, so every async path degrades
 * gracefully: search falls back to the curated set offline, and install surfaces
 * device errors inline rather than throwing.
 *
 * VISUALS (skeuomorph "manila tags on green felt"): each package is rendered as
 * a manila filing tag — kraft spine, silver eyelet, rubber-stamp version, and a
 * gold-key INSTALL action / green INSTALLED stamp — laid on the same green-felt
 * panel as Source Control. The behaviour is unchanged; the active list is split
 * into INSTALLED (packages this session has installed) and REGISTRY groups, and
 * a flash-usage meter under the header reads `os.statvfs('/')` off the connected
 * board (placeholder dashes when disconnected).
 */

/** Per-package install UI state, keyed by package name. */
interface InstallState {
  status: 'installing' | 'done' | 'error'
  log: string
  notes: string[]
}

/** Live flash-storage figures read off the board, in KB. */
interface FlashUsage {
  usedKb: number
  totalKb: number
}

/**
 * The two views the Packages activity surface hosts. `packages` is the original
 * mip/PyPI installer (#20); `modules` is the per-component module installer
 * (#120 — the Modules manager), reached via the tab bar below without adding a
 * new activity-bar view (which would need an AppShell edit). They sit together
 * because "modules on the board" is the per-component complement to packages.
 */
type PackagesTab = 'packages' | 'modules'

/**
 * The Packages activity surface: a tab bar switching between the PyPI/mip
 * package installer and the #120 Modules manager. Keeps both on the existing
 * Packages view (no AppShell / ActivityBar churn).
 */
export function PackagesPanel(): JSX.Element {
  const [tab, setTab] = useState<PackagesTab>('packages')
  return (
    <div className="pkgs-shell">
      <div className="pkgs-tabs" role="tablist" aria-label="Packages and modules">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'packages'}
          className={`pkgs-tab${tab === 'packages' ? ' is-active' : ''}`}
          onClick={() => setTab('packages')}
        >
          Packages
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'modules'}
          className={`pkgs-tab${tab === 'modules' ? ' is-active' : ''}`}
          onClick={() => setTab('modules')}
        >
          Modules
        </button>
      </div>
      {tab === 'packages' ? <PackagesTab /> : <ModulesPanel />}
    </div>
  )
}

/** The original mip/PyPI package installer (#20), now hosted under a tab. */
function PackagesTab(): JSX.Element {
  const status = useDeviceStatus()
  const connected = status.state === 'connected'

  // Discovery (curated top packages), loaded once on mount.
  const [top, setTop] = useState<PackageInfo[]>([])

  // Search.
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<PackageInfo[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)

  // Advanced options.
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [overwrite, setOverwrite] = useState(true)
  const [convertMpy, setConvertMpy] = useState(false)
  const [customIndex, setCustomIndex] = useState('')

  // Install state per package.
  const [installs, setInstalls] = useState<Record<string, InstallState>>({})

  // Flash usage read from the board (null until/unless a board reports it).
  const [flash, setFlash] = useState<FlashUsage | null>(null)

  useEffect(() => {
    let active = true
    window.api.packages
      .topPackages()
      .then((pkgs) => {
        if (active) setTop(pkgs)
      })
      .catch(() => undefined)
    return () => {
      active = false
    }
  }, [])

  // Poll the board's flash usage via os.statvfs('/'). Runs on connect and after
  // each install (installs land files on /lib). Degrades silently: any error
  // (no statvfs, busy REPL, disconnect) just clears the figures to dashes.
  const installCount = Object.values(installs).filter((s) => s.status === 'done').length
  useEffect(() => {
    if (!connected) {
      setFlash(null)
      return
    }
    let active = true
    // os.statvfs -> (f_bsize, f_frsize, f_blocks, f_bfree, f_bavail, ...).
    // total = f_frsize * f_blocks; used = total - (f_frsize * free blocks).
    const snippet =
      "import os\n" +
      "s=os.statvfs('/')\n" +
      "print(s[1]*s[2], s[1]*(s[2]-(s[4] if s[4] else s[3])))"
    window.api.device
      .eval(snippet)
      .then((out) => {
        if (!active) return
        const nums = out.trim().split(/\s+/).map(Number)
        const total = nums[0]
        const used = nums[1]
        if (Number.isFinite(total) && Number.isFinite(used) && total > 0) {
          setFlash({ usedKb: Math.round(used / 1024), totalKb: Math.round(total / 1024) })
        } else {
          setFlash(null)
        }
      })
      .catch(() => {
        if (active) setFlash(null)
      })
    return () => {
      active = false
    }
  }, [connected, installCount])

  const runSearch = useCallback(async (): Promise<void> => {
    const q = query.trim()
    if (!q) {
      setResults(null)
      setSearchError(null)
      return
    }
    setSearching(true)
    setSearchError(null)
    try {
      const found = await window.api.packages.search(q)
      setResults(found)
      if (found.length === 0) {
        setSearchError(`No packages found for "${q}".`)
      }
    } catch (err) {
      setSearchError(err instanceof Error ? err.message : String(err))
      setResults([])
    } finally {
      setSearching(false)
    }
  }, [query])

  const install = useCallback(
    async (name: string): Promise<void> => {
      setInstalls((prev) => ({
        ...prev,
        [name]: { status: 'installing', log: '', notes: [] }
      }))
      const collectedNotes: string[] = []
      const onProgress = (p: InstallProgress): void => {
        if (p.state === 'note' && p.message) collectedNotes.push(p.message)
      }
      try {
        const result = await window.api.packages.install(
          name,
          {
            overwrite,
            mpy: convertMpy,
            index: customIndex.trim() || undefined
          },
          onProgress
        )
        setInstalls((prev) => ({
          ...prev,
          [name]: {
            status: result.ok ? 'done' : 'error',
            log: result.log,
            notes: result.notes.length ? result.notes : collectedNotes
          }
        }))
      } catch (err) {
        setInstalls((prev) => ({
          ...prev,
          [name]: {
            status: 'error',
            log: err instanceof Error ? err.message : String(err),
            notes: collectedNotes
          }
        }))
      }
    },
    [overwrite, convertMpy, customIndex]
  )

  const listToShow = results ?? top

  // Split the active list into INSTALLED (this session has installed it) and
  // REGISTRY. The package layer has no "list installed" call, so "installed"
  // here means a successful install during this session.
  const [installed, registry] = useMemo(() => {
    const inst: PackageInfo[] = []
    const reg: PackageInfo[] = []
    for (const pkg of listToShow) {
      if (installs[pkg.name]?.status === 'done') inst.push(pkg)
      else reg.push(pkg)
    }
    return [inst, reg]
  }, [listToShow, installs])

  const flashPct = flash ? Math.min(100, Math.round((flash.usedKb / flash.totalKb) * 100)) : 0
  const flashReadout = flash
    ? `FLASH ${flash.usedKb} / ${flash.totalKb} KB`
    : 'FLASH — / — KB'

  const renderTag = (pkg: PackageInfo): JSX.Element => {
    const st = installs[pkg.name]
    const isInstalled = st?.status === 'done'
    let action: JSX.Element
    if (isInstalled) {
      action = <span className="pkgs__stamp pkgs__stamp--installed">INSTALLED</span>
    } else {
      const installing = st?.status === 'installing'
      const label = installing ? 'INSTALLING…' : st?.status === 'error' ? 'RETRY' : 'INSTALL'
      action = (
        <button
          type="button"
          className="pkgs__key"
          disabled={!connected || installing}
          title={connected ? `Install ${pkg.name}` : 'Connect a board first'}
          onClick={() => void install(pkg.name)}
        >
          {label}
        </button>
      )
    }
    return (
      <li key={`${pkg.source}:${pkg.name}`} className="pkgs__tag">
        <span className="pkgs__tag-spine" aria-hidden="true" />
        <span className="pkgs__tag-eyelet" aria-hidden="true" />
        <div className="pkgs__tag-body">
          <div className="pkgs__tag-head">
            <span className="pkgs__name">{pkg.name}</span>
            {pkg.version && <span className="pkgs__version">v{pkg.version}</span>}
          </div>
          {pkg.description && <p className="pkgs__desc">{pkg.description}</p>}
          {st && (st.notes.length > 0 || st.log) && (
            <div className="pkgs__result">
              {st.notes.map((n, i) => (
                <p key={i} className="pkgs__note">
                  {n}
                </p>
              ))}
              {st.log && (
                <pre className={`pkgs__log${st.status === 'error' ? ' pkgs__log--error' : ''}`}>
                  {st.log}
                </pre>
              )}
            </div>
          )}
          <div className="pkgs__tag-foot">
            <span className="pkgs__src">{pkg.source}</span>
            {action}
          </div>
        </div>
      </li>
    )
  }

  return (
    <div className="pkgs">
      <div className="pkgs__header">
        <span className="pkgs__title">PACKAGES</span>
        <span className="pkgs__flash-readout">{flashReadout}</span>
      </div>

      <div
        className="pkgs__meter"
        role="meter"
        aria-label="Flash storage used"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={flashPct}
      >
        <span className="pkgs__meter-fill" style={{ width: `${flashPct}%` }} />
      </div>

      <form
        className="pkgs__search"
        onSubmit={(e) => {
          e.preventDefault()
          void runSearch()
        }}
      >
        <input
          type="search"
          className="pkgs__search-input"
          placeholder="Search packages…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search packages"
        />
        <button type="submit" className="pkgs__search-btn" disabled={searching}>
          {searching ? '…' : 'Search'}
        </button>
        {results != null && (
          <button
            type="button"
            className="pkgs__search-clear"
            onClick={() => {
              setQuery('')
              setResults(null)
              setSearchError(null)
            }}
          >
            Clear
          </button>
        )}
      </form>

      {!connected && (
        <p className="pkgs__hint" role="status">
          Connect a board to install packages. You can still search and browse
          popular libraries below.
        </p>
      )}

      <details
        className="pkgs__advanced"
        open={showAdvanced}
        onToggle={(e) => setShowAdvanced((e.target as HTMLDetailsElement).open)}
      >
        <summary className="pkgs__advanced-summary">Advanced options</summary>
        <label className="pkgs__opt">
          <input
            type="checkbox"
            checked={overwrite}
            onChange={(e) => setOverwrite(e.target.checked)}
          />
          <span>Overwrite existing files</span>
        </label>
        <label className="pkgs__opt">
          <input
            type="checkbox"
            checked={convertMpy}
            onChange={(e) => setConvertMpy(e.target.checked)}
          />
          <span>
            Convert to <code>.mpy</code> (optimise size/speed)
          </span>
        </label>
        <label className="pkgs__opt pkgs__opt--field">
          <span>Custom index URL</span>
          <input
            type="text"
            className="pkgs__index-input"
            placeholder="https://micropython.org/pi/v2"
            value={customIndex}
            onChange={(e) => setCustomIndex(e.target.value)}
          />
        </label>
        {convertMpy && (
          <p className="pkgs__note">
            Note: this build has no bundled <code>mpy-cross</code>, so packages
            install as source <code>.py</code>. Many ports still compile to
            bytecode on import.
          </p>
        )}
      </details>

      {searchError != null && <p className="pkgs__error">{searchError}</p>}

      {installed.length > 0 && (
        <>
          <div className="pkgs__group-head">INSTALLED — {installed.length}</div>
          <ul className="pkgs__list" role="list">
            {installed.map(renderTag)}
          </ul>
        </>
      )}

      <div className="pkgs__group-head">REGISTRY</div>
      <ul className="pkgs__list" role="list">
        {registry.map(renderTag)}
      </ul>

      {listToShow.length === 0 && !searching && (
        <p className="pkgs__hint">No packages to show.</p>
      )}
    </div>
  )
}
