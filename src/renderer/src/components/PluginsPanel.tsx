import { useCallback, useEffect, useMemo, useState } from 'react'
import './PluginsPanel.css'
import { useWorkspace } from '../store/workspace'
import { PLUGIN_STATUS_EVENT } from './StatusBar'
import type {
  CommandInfo,
  PluginAction,
  PluginContext,
  PluginInfo,
  PluginStatus
} from '../../../preload/index.d'

/**
 * PLUGINS TAB — "module rack" skeuomorph (issue #61)
 * ==================================================
 *
 * Lists the Python plugins Snakie discovered (via the spawned `snakie.host`)
 * and the commands each registered, rendered as a eurorack-style **module
 * rack**: each plugin is a brushed-aluminium **faceplate** seated on mounting
 * rails. Pressing a module's **Run** affordance sends the active editor file as
 * context and applies the returned actions: a `message` shows as a notice here;
 * an `edit` replaces the active buffer's contents through the workspace store
 * (marking it dirty).
 *
 * The host only reports *discovered* plugins (there is no installed/enabled
 * distinction), so the rack metaphor maps onto the real load state:
 *  - MOUNTED   = plugins that imported OK (`ok === true`). Knob points up,
 *                green LED lit, patch jack present; clicking the faceplate
 *                expands its command list with Run buttons.
 *  - AVAILABLE = plugins that *failed* to import (`ok === false`). Knob points
 *                down, no LED; a gold **GET** button re-spawns the host (the
 *                real "try to mount it" action) and the load error is shown.
 *                When every plugin loaded OK this group is empty and skipped.
 *
 * Everything degrades gracefully. When no Python interpreter is found,
 * `status().pythonFound` is false and the panel shows a clear install prompt
 * instead of an error. The rack interior is intentionally dark in both the
 * light/skeuomorph and dark themes — per the Skeuomorph handoff.
 */

/** A timestamped notice shown in the panel (from `message` actions / errors). */
interface Notice {
  id: number
  level: 'info' | 'warning' | 'error'
  text: string
}

let noticeSeq = 0

/** Per-module accent stripe / pointer / LED-glow colour cycle. */
const ACCENTS = ['#36c46a', '#4a9fe0', '#f0b13c', '#3fc8b8', '#b06be0', '#ff6a3c'] as const

/** Two hex screws per rail, rotated at "hand-tightened" angles for realism. */
const SCREW_ANGLES = [22, -14, -38, 47]

export function PluginsPanel(): JSX.Element {
  const { openFiles, activeId, updateContent } = useWorkspace()
  const activeFile = openFiles.find((f) => f.id === activeId) ?? null

  const [status, setStatus] = useState<PluginStatus | null>(null)
  const [plugins, setPlugins] = useState<PluginInfo[]>([])
  const [commands, setCommands] = useState<CommandInfo[]>([])
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notices, setNotices] = useState<Notice[]>([])
  const [query, setQuery] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)

  const pushNotice = useCallback((level: Notice['level'], text: string): void => {
    setNotices((prev) => [{ id: ++noticeSeq, level, text }, ...prev].slice(0, 8))
  }, [])

  /** Load status, then (if Python was found) plugins + commands. */
  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true)
    setError(null)
    try {
      const st = await window.api.plugins.status()
      setStatus(st)
      if (st.pythonFound) {
        const listing = await window.api.plugins.list()
        setPlugins(listing.plugins)
        setCommands(listing.commands)
      } else {
        setPlugins([])
        setCommands([])
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const reload = useCallback(async (): Promise<void> => {
    setLoading(true)
    setError(null)
    try {
      await window.api.plugins.reload()
      await refresh()
      pushNotice('info', 'Reloaded plugins.')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setLoading(false)
    }
  }, [refresh, pushNotice])

  /** Apply a single returned action to the workspace / notices. */
  const applyAction = useCallback(
    (action: PluginAction): void => {
      switch (action.type) {
        case 'message':
          pushNotice(action.level, action.text)
          break
        case 'edit':
          if (activeId) {
            updateContent(activeId, action.content)
            pushNotice('info', `Applied edit to ${activeFile?.name ?? 'file'}.`)
          } else {
            pushNotice('warning', 'No active file to apply the edit to.')
          }
          break
        case 'diagnostic':
          pushNotice(
            'info',
            `Diagnostic (line ${action.item.line}): ${action.item.message}`
          )
          break
        case 'status':
          // Route status-bar messages to the StatusBar via a window event so we
          // don't introduce shared state just for this hop (issue #71).
          window.dispatchEvent(
            new CustomEvent(PLUGIN_STATUS_EVENT, {
              detail: {
                text: action.text,
                tooltip: action.tooltip,
                href: action.href,
                priority: action.priority
              }
            })
          )
          pushNotice('info', `Status: ${action.text}`)
          break
        default:
          break
      }
    },
    [activeId, activeFile, updateContent, pushNotice]
  )

  const runCommand = useCallback(
    async (command: CommandInfo): Promise<void> => {
      if (!activeFile) {
        pushNotice('warning', 'Open a file first — commands run against the active file.')
        return
      }
      setBusy(command.id)
      setError(null)
      const context: PluginContext = {
        file: {
          path: activeFile.path,
          name: activeFile.name,
          source: activeFile.source,
          content: activeFile.content
        }
      }
      try {
        const { actions } = await window.api.plugins.runCommand(command.id, context)
        if (actions.length === 0) {
          pushNotice('info', `${command.title} ran (no actions).`)
        }
        for (const action of actions) applyAction(action)
      } catch (err) {
        pushNotice('error', `${command.title} failed: ${err instanceof Error ? err.message : String(err)}`)
      } finally {
        setBusy(null)
      }
    },
    [activeFile, applyAction, pushNotice]
  )

  // --- Split the real plugin list into rack groups + filter by search -------
  const { mounted, available } = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const matches = (p: PluginInfo): boolean => {
      if (!needle) return true
      const hay = `${p.name} ${p.id} ${p.source}`.toLowerCase()
      const cmdHit = commands.some(
        (c) => c.pluginId === p.id && c.title.toLowerCase().includes(needle)
      )
      return hay.includes(needle) || cmdHit
    }
    const filtered = plugins.filter(matches)
    return {
      mounted: filtered.filter((p) => p.ok),
      available: filtered.filter((p) => !p.ok)
    }
  }, [plugins, commands, query])

  // Stable accent index keyed off the unfiltered list so a module keeps its
  // colour as the search narrows the rack.
  const accentOf = useCallback(
    (id: string): string => {
      const idx = plugins.findIndex((p) => p.id === id)
      return ACCENTS[(idx < 0 ? 0 : idx) % ACCENTS.length]
    },
    [plugins]
  )

  // --- Render: Python not found -------------------------------------------
  if (status && !status.pythonFound) {
    return (
      <div className="rack rack--empty">
        <RackHeader python={status.python} loading={loading} onReload={() => void reload()} />
        <div className="rack__empty-body">
          <p className="rack__empty-note">
            <strong>Python not found.</strong> The plugin system runs your local
            Python. Install Python 3 and the SDK:
          </p>
          <pre className="rack__code">pip install snakie</pre>
          <p className="rack__empty-note rack__empty-detail">{status.error}</p>
        </div>
      </div>
    )
  }

  const renderModule = (p: PluginInfo): JSX.Element => {
    const accent = accentOf(p.id)
    const pluginCommands = commands.filter((c) => c.pluginId === p.id)
    const isMounted = p.ok
    const isOpen = expanded === p.id
    const knobAngle = isMounted ? 38 : -128

    return (
      <li key={p.id} className="rack__module-wrap">
        <div
          className={`rack__module${
            isMounted ? ' rack__module--mounted' : ' rack__module--available'
          }${isOpen ? ' rack__module--open' : ''}`}
          role={isMounted ? 'button' : undefined}
          tabIndex={isMounted ? 0 : undefined}
          aria-expanded={isMounted ? isOpen : undefined}
          onClick={
            isMounted ? () => setExpanded((cur) => (cur === p.id ? null : p.id)) : undefined
          }
          onKeyDown={
            isMounted
              ? (e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    setExpanded((cur) => (cur === p.id ? null : p.id))
                  }
                }
              : undefined
          }
          title={
            isMounted
              ? pluginCommands.length > 0
                ? `${pluginCommands.length} command${
                    pluginCommands.length === 1 ? '' : 's'
                  } — click to open`
                : 'No commands registered'
              : `Failed to load: ${p.error ?? 'unknown error'}`
          }
        >
          {/* Left mounting rail + hex screws */}
          <span className="rack__rail rack__rail--left" aria-hidden="true">
            <span className="rack__screw" style={{ transform: `rotate(${SCREW_ANGLES[0]}deg)` }} />
            <span className="rack__screw" style={{ transform: `rotate(${SCREW_ANGLES[1]}deg)` }} />
          </span>

          {/* Accent stripe */}
          <span
            className="rack__stripe"
            style={{ background: accent, boxShadow: `0 0 6px ${accent}` }}
            aria-hidden="true"
          />

          {/* Silkscreen text column */}
          <span className="rack__label">
            <span className="rack__title">{p.name}</span>
            <span className="rack__desc">
              {isMounted
                ? pluginCommands.length > 0
                  ? pluginCommands.map((c) => c.title).join(' · ')
                  : 'No commands registered'
                : `Failed to load — ${p.error ?? 'unknown error'}`}
            </span>
            <span className="rack__meta">
              {p.id} · {p.source}
            </span>
          </span>

          {/* Controls cluster */}
          <span className="rack__controls" aria-hidden="true">
            <span className="rack__knob">
              <span
                className="rack__knob-pointer"
                style={{ background: accent, transform: `rotate(${knobAngle}deg)` }}
              />
            </span>
            {isMounted ? (
              <>
                <span className="rack__led" />
                <span className="rack__jack" />
              </>
            ) : null}
          </span>

          {/* AVAILABLE → gold GET button (re-spawns the host) */}
          {!isMounted && (
            <button
              type="button"
              className="rack__get"
              disabled={loading}
              title="Reload the plugin host to try mounting this module"
              onClick={(e) => {
                e.stopPropagation()
                void reload()
              }}
            >
              GET
            </button>
          )}

          {/* Right mounting rail + hex screws */}
          <span className="rack__rail rack__rail--right" aria-hidden="true">
            <span className="rack__screw" style={{ transform: `rotate(${SCREW_ANGLES[2]}deg)` }} />
            <span className="rack__screw" style={{ transform: `rotate(${SCREW_ANGLES[3]}deg)` }} />
          </span>
        </div>

        {/* Expanded patch panel: the module's commands, each with a Run button.
            Preserves the original per-command Run behaviour exactly. */}
        {isMounted && isOpen && (
          <div className="rack__patch">
            {pluginCommands.length === 0 ? (
              <p className="rack__patch-empty">No commands registered.</p>
            ) : (
              <ul className="rack__commands">
                {pluginCommands.map((c) => (
                  <li key={c.id} className="rack__command">
                    <span className="rack__command-title">{c.title}</span>
                    <button
                      type="button"
                      className="rack__run"
                      disabled={busy !== null}
                      title={
                        activeFile
                          ? `Run against ${activeFile.name}`
                          : 'Open a file to run against'
                      }
                      onClick={() => void runCommand(c)}
                    >
                      {busy === c.id ? 'RUN…' : 'RUN'}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </li>
    )
  }

  const noPlugins = !loading && plugins.length === 0 && !error
  const noMatches =
    !loading && plugins.length > 0 && mounted.length === 0 && available.length === 0

  return (
    <div className="rack">
      <RackHeader python={status?.python} loading={loading} onReload={() => void reload()} />

      {/* Recessed search slot */}
      <div className="rack__search">
        <span className="rack__search-icon" aria-hidden="true">
          ⌕
        </span>
        <input
          type="search"
          className="rack__search-input"
          placeholder="Search modules…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search modules"
        />
      </div>

      <p className="rack__trust" role="note">
        Modules run Python code on your machine. Only mount modules you trust.
      </p>

      {error && (
        <p className="rack__error" role="alert">
          {error}
        </p>
      )}

      {/* Module list */}
      <div className="rack__list">
        {loading && plugins.length === 0 && (
          <p className="rack__empty-note">Scanning the rack…</p>
        )}
        {noPlugins && (
          <p className="rack__empty-note">
            No modules found. Drop a Python file in <code>~/.snakie/plugins/</code> and
            press the reload knob. See <code>docs/writing-plugins.md</code>.
          </p>
        )}
        {noMatches && <p className="rack__empty-note">No modules match “{query}”.</p>}

        {mounted.length > 0 && (
          <>
            <p className="rack__group-label">MOUNTED — {mounted.length}</p>
            <ul className="rack__modules">{mounted.map(renderModule)}</ul>
          </>
        )}

        {available.length > 0 && (
          <>
            <p className="rack__group-label">AVAILABLE MODULES</p>
            <ul className="rack__modules">{available.map(renderModule)}</ul>
          </>
        )}
      </div>

      {/* Notices (messages / applied edits / errors) */}
      {notices.length > 0 && (
        <div className="rack__notices" aria-label="Module output">
          {notices.map((n) => (
            <p key={n.id} className={`rack__notice rack__notice--${n.level}`}>
              {n.text}
            </p>
          ))}
        </div>
      )}
    </div>
  )
}

/** The rack header: PLUGIN RACK silkscreen + a PWR label and lit green LED. */
function RackHeader({
  python,
  loading,
  onReload
}: {
  python?: string
  loading: boolean
  onReload: () => void
}): JSX.Element {
  return (
    <div className="rack__header">
      <span className="rack__brand">PLUGIN RACK</span>
      <span className="rack__header-spacer" />
      <button
        type="button"
        className="rack__reload"
        title={python ? `Reload plugin host (${python})` : 'Reload plugin host'}
        disabled={loading}
        onClick={onReload}
      >
        ⟳
      </button>
      <span className="rack__pwr">
        <span className="rack__pwr-label">PWR</span>
        <span className={`rack__pwr-led${loading ? ' rack__pwr-led--busy' : ''}`} />
      </span>
    </div>
  )
}
