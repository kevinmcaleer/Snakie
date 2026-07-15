import { useCallback, useEffect, useMemo, useState } from 'react'
import './PackagesPanel.css'
import { useDeviceStatus } from '../hooks/useDeviceStatus'
import { useWorkspace } from '../store/workspace'
import { parsePyImports } from './part-imports'
import { isNewerVersion } from '../../../shared/version-compare'
import {
  libEntryToPackage,
  buildVersionProbe,
  parseVersionProbe,
  missingProjectImports,
  type BoardPackage
} from '../lib/board-packages'
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
  const { currentFolder } = useWorkspace()

  // ── On-board packages (#131): the REAL installed list, read from /lib ──────
  const [boardPkgs, setBoardPkgs] = useState<BoardPackage[] | null>(null)
  const [uninstalling, setUninstalling] = useState<Record<string, boolean>>({})
  const [boardNonce, setBoardNonce] = useState(0)
  // Import scan (#131): project imports with nothing to satisfy them.
  const [missing, setMissing] = useState<string[] | null>(null)
  const [scanBusy, setScanBusy] = useState(false)

  // ANY surface that writes modules to the board — the driver banners, the
  // instruments-library update flow, another window — fires the modules
  // broadcast. Re-read /lib so ON BOARD reflects installs we didn't make.
  useEffect(() => window.api.modules.onChanged(() => setBoardNonce((n) => n + 1)), [])

  const uninstall = useCallback(async (pkg: BoardPackage): Promise<void> => {
    setUninstalling((u) => ({ ...u, [pkg.name]: true }))
    try {
      await window.api.device.remove(pkg.path) // recursive on every backend
      window.api.modules.notifyChanged() // device tree + banners refresh
    } catch {
      /* surfaced by the list simply still containing the package */
    } finally {
      setUninstalling((u) => ({ ...u, [pkg.name]: false }))
      setBoardNonce((n) => n + 1)
    }
  }, [])

  // Scan every project .py for imports and diff against builtins + /lib + the
  // project's own modules (a local servo.py satisfies `import servo`).
  const scanImports = useCallback(async (): Promise<void> => {
    if (!currentFolder) return
    setScanBusy(true)
    try {
      const imports = new Set<string>()
      const projectModules = new Set<string>()
      const walk = async (dir: string, depth: number): Promise<void> => {
        if (depth > 3) return
        const entries = await window.api.fs.readDir(dir)
        for (const e of entries) {
          if (e.isDir) {
            if (!/^(\.|__pycache__|node_modules|lib$)/.test(e.name)) await walk(e.path, depth + 1)
          } else if (e.name.endsWith('.py')) {
            projectModules.add(e.name.replace(/\.py$/, ''))
            try {
              for (const imp of parsePyImports(await window.api.fs.readFile(e.path))) imports.add(imp)
            } catch {
              /* unreadable file — skip */
            }
          }
        }
      }
      await walk(currentFolder, 0)
      const onBoard = (boardPkgs ?? []).map((b) => b.name)
      setMissing(missingProjectImports(imports, onBoard, projectModules))
    } catch {
      setMissing(null)
    } finally {
      setScanBusy(false)
    }
  }, [currentFolder, boardPkgs])

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

  // Read the board's real /lib listing + versions. Re-runs on connect, after
  // each install (installCount) and after uninstalls (boardNonce).
  useEffect(() => {
    if (!connected) {
      setBoardPkgs(null)
      return
    }
    let active = true
    void (async () => {
      try {
        const entries = await window.api.device.listDir('/lib')
        const pkgs = entries
          .map((e) => libEntryToPackage(e))
          .filter((x): x is BoardPackage => x !== null)
        if (pkgs.length > 0) {
          try {
            const out = await window.api.device.eval(buildVersionProbe(pkgs))
            const versions = parseVersionProbe(out)
            for (const p of pkgs) if (versions[p.name]) p.version = versions[p.name]
          } catch {
            /* version probe is best-effort */
          }
        }
        if (active) setBoardPkgs(pkgs.sort((a, b) => a.name.localeCompare(b.name)))
      } catch {
        if (active) setBoardPkgs([]) // no /lib yet — an empty board list
      }
    })()
    return () => {
      active = false
    }
  }, [connected, installCount, boardNonce])

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
        // A successful install wrote files to the board — tell every window so
        // the Device Files tree (and the library banners) refresh.
        if (result.ok) window.api.modules.notifyChanged()
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

  // Latest registry version for an on-board package (search results or the
  // curated list), for the Upgrade affordance.
  const registryVersion = (name: string): string | undefined =>
    listToShow.find((p) => p.name.toLowerCase() === name.toLowerCase())?.version

  const renderBoardTag = (pkg: BoardPackage): JSX.Element => {
    const latest = registryVersion(pkg.name)
    const upgradable = !!(pkg.version && latest && isNewerVersion(latest, pkg.version))
    const busy = !!uninstalling[pkg.name] || installs[pkg.name]?.status === 'installing'
    return (
      <li key={pkg.path} className="pkgs__tag pkgs__tag--board" role="listitem">
        <span className="pkgs__tag-name">{pkg.name}</span>
        {pkg.version && <span className="pkgs__ver">v{pkg.version}</span>}
        <span className="pkgs__spacer" />
        {upgradable && (
          <button
            type="button"
            className="pkgs__act pkgs__act--upgrade"
            disabled={busy}
            onClick={() => void install(pkg.name)}
            title={`Upgrade to v${latest}`}
          >
            ⬆ v{latest}
          </button>
        )}
        <button
          type="button"
          className="pkgs__act pkgs__act--uninstall"
          disabled={busy}
          onClick={() => void uninstall(pkg)}
          title={`Delete ${pkg.path} from the board`}
        >
          {uninstalling[pkg.name] ? 'Removing…' : 'Uninstall'}
        </button>
      </li>
    )
  }

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

      {/* Import scan (#131): project imports with nothing to satisfy them. */}
      {connected && currentFolder && (
        <div className="pkgs__scanrow">
          <button
            type="button"
            className="pkgs__act"
            disabled={scanBusy}
            onClick={() => void scanImports()}
            title="Scan the project's .py files and list imports that nothing satisfies"
          >
            {scanBusy ? 'Scanning…' : '⌕ Scan imports'}
          </button>
          {missing !== null &&
            (missing.length === 0 ? (
              <span className="pkgs__scan-ok">All imports satisfied ✓</span>
            ) : (
              <span className="pkgs__scan-missing">
                Missing:{' '}
                {missing.map((name) => (
                  <button
                    key={name}
                    type="button"
                    className="pkgs__chip"
                    disabled={installs[name]?.status === 'installing'}
                    onClick={() => void install(name)}
                    title={`Install ${name} with mip`}
                  >
                    {installs[name]?.status === 'installing' ? `${name}…` : `+ ${name}`}
                  </button>
                ))}
              </span>
            ))}
        </div>
      )}

      {connected && boardPkgs !== null ? (
        <>
          <div className="pkgs__group-head">ON BOARD (/lib) — {boardPkgs.length}</div>
          {boardPkgs.length > 0 ? (
            <ul className="pkgs__list" role="list">
              {boardPkgs.map(renderBoardTag)}
            </ul>
          ) : (
            <p className="pkgs__hint">Nothing in /lib yet — install something below.</p>
          )}
        </>
      ) : (
        installed.length > 0 && (
          <>
            <div className="pkgs__group-head">INSTALLED — {installed.length}</div>
            <ul className="pkgs__list" role="list">
              {installed.map(renderTag)}
            </ul>
          </>
        )
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
