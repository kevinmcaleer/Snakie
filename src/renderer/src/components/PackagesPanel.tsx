import { useCallback, useEffect, useState } from 'react'
import './PackagesPanel.css'
import { useDeviceStatus } from '../hooks/useDeviceStatus'
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
 */

/** Per-package install UI state, keyed by package name. */
interface InstallState {
  status: 'installing' | 'done' | 'error'
  log: string
  notes: string[]
}

export function PackagesPanel(): JSX.Element {
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
  const listLabel = results ? 'Search results' : 'Popular packages'

  return (
    <div className="pkgs">
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
          placeholder="Search packages (e.g. urequests, microdot)…"
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

      <div className="pkgs__list-head">{listLabel}</div>
      <ul className="pkgs__list" role="list">
        {listToShow.map((pkg) => {
          const st = installs[pkg.name]
          return (
            <li key={`${pkg.source}:${pkg.name}`} className="pkgs__item">
              <div className="pkgs__item-main">
                <div className="pkgs__item-head">
                  <span className="pkgs__name">{pkg.name}</span>
                  {pkg.version && <span className="pkgs__version">{pkg.version}</span>}
                  <span className={`pkgs__src pkgs__src--${pkg.source}`}>{pkg.source}</span>
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
                      <pre
                        className={`pkgs__log${st.status === 'error' ? ' pkgs__log--error' : ''}`}
                      >
                        {st.log}
                      </pre>
                    )}
                  </div>
                )}
              </div>
              <button
                type="button"
                className="pkgs__install-btn"
                disabled={!connected || st?.status === 'installing'}
                title={connected ? `Install ${pkg.name}` : 'Connect a board first'}
                onClick={() => void install(pkg.name)}
              >
                {st?.status === 'installing'
                  ? 'Installing…'
                  : st?.status === 'done'
                    ? 'Installed ✓'
                    : st?.status === 'error'
                      ? 'Retry'
                      : 'Install'}
              </button>
            </li>
          )
        })}
      </ul>

      {listToShow.length === 0 && !searching && (
        <p className="pkgs__hint">No packages to show.</p>
      )}
    </div>
  )
}
