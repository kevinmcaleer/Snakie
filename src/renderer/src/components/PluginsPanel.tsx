import { useCallback, useEffect, useState } from 'react'
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
 * PLUGINS TAB (issue #61)
 * =======================
 *
 * Lists the Python plugins Snakie discovered (via the spawned `snakie.host`)
 * and the commands each registered. Pressing **Run** sends the active editor
 * file as context and applies the returned actions: a `message` shows as a
 * notice here; an `edit` replaces the active buffer's contents through the
 * workspace store (marking it dirty).
 *
 * Everything degrades gracefully. When no Python interpreter is found,
 * `status().pythonFound` is false and the panel shows a clear install prompt
 * instead of an error. A **Reload** action re-spawns the host so newly added
 * `~/.snakie/plugins/` files are picked up.
 */

/** A timestamped notice shown in the panel (from `message` actions / errors). */
interface Notice {
  id: number
  level: 'info' | 'warning' | 'error'
  text: string
}

let noticeSeq = 0

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

  // --- Render: Python not found -------------------------------------------
  if (status && !status.pythonFound) {
    return (
      <div className="plugins plugins--empty">
        <p className="plugins__empty-note">
          <strong>Python not found.</strong> The plugin system runs your local
          Python. Install Python 3 and the SDK:
        </p>
        <pre className="plugins__code">pip install snakie</pre>
        <p className="plugins__empty-note plugins__empty-detail">{status.error}</p>
        <button type="button" className="plugins__btn" onClick={() => void reload()}>
          Reload
        </button>
      </div>
    )
  }

  return (
    <div className="plugins">
      <div className="plugins__toolbar">
        <span className="plugins__interpreter" title={status?.python ?? ''}>
          {status?.python ? `Python: ${status.python}` : 'Plugins'}
        </span>
        <span className="plugins__toolbar-spacer" />
        <button
          type="button"
          className="plugins__icon-btn"
          title="Reload plugins"
          disabled={loading}
          onClick={() => void reload()}
        >
          ⟳
        </button>
      </div>

      <p className="plugins__trust" role="note">
        Plugins run Python code on your machine. Only install plugins you trust.
      </p>

      {error && (
        <p className="plugins__error" role="alert">
          {error}
        </p>
      )}

      {/* Plugin + command list */}
      <div className="plugins__list">
        {loading && plugins.length === 0 && (
          <p className="plugins__empty-note">Loading plugins…</p>
        )}
        {!loading && plugins.length === 0 && !error && (
          <p className="plugins__empty-note">
            No plugins found. Drop a Python file in <code>~/.snakie/plugins/</code> and
            press Reload. See <code>docs/writing-plugins.md</code>.
          </p>
        )}
        {plugins.map((p) => {
          const pluginCommands = commands.filter((c) => c.pluginId === p.id)
          return (
            <section key={p.id} className="plugins__plugin">
              <header className="plugins__plugin-head">
                <span className="plugins__plugin-name">{p.name}</span>
                <span className={`plugins__source plugins__source--${p.source}`}>
                  {p.source}
                </span>
              </header>
              {!p.ok && (
                <p className="plugins__plugin-error" role="alert">
                  Failed to load: {p.error}
                </p>
              )}
              {p.ok && pluginCommands.length === 0 && (
                <p className="plugins__empty-note plugins__empty-detail">
                  No commands registered.
                </p>
              )}
              <ul className="plugins__commands">
                {pluginCommands.map((c) => (
                  <li key={c.id} className="plugins__command">
                    <span className="plugins__command-title">{c.title}</span>
                    <button
                      type="button"
                      className="plugins__btn plugins__btn--run"
                      disabled={busy !== null}
                      title={
                        activeFile
                          ? `Run against ${activeFile.name}`
                          : 'Open a file to run against'
                      }
                      onClick={() => void runCommand(c)}
                    >
                      {busy === c.id ? 'Running…' : 'Run'}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )
        })}
      </div>

      {/* Notices (messages / applied edits / errors) */}
      {notices.length > 0 && (
        <div className="plugins__notices" aria-label="Plugin output">
          {notices.map((n) => (
            <p key={n.id} className={`plugins__notice plugins__notice--${n.level}`}>
              {n.text}
            </p>
          ))}
        </div>
      )}
    </div>
  )
}
