import { useEffect, useRef } from 'react'
// Import only the editor core API rather than the full `monaco-editor` barrel,
// then opt in to just the languages we render. This keeps the renderer bundle
// small instead of pulling in all ~80 bundled languages.
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api'
import 'monaco-editor/esm/vs/editor/editor.all'
import 'monaco-editor/esm/vs/basic-languages/python/python.contribution'
import 'monaco-editor/esm/vs/basic-languages/markdown/markdown.contribution'
import './monaco-setup'
import { useWorkspace } from '../store/workspace'
import { useDiagnostics } from '../store/diagnostics'
import { useLocalStorage } from '../hooks/useLocalStorage'
import type { Diagnostic, PluginContext } from '../../../preload/index.d'
import { diagnosticToMarker } from './plugin-diagnostics'
import {
  clearModelDiagnostics,
  registerPluginCodeActions,
  setModelDiagnostics
} from './plugin-code-actions'

// Register the plugin quick-fix (lightbulb) provider exactly once at module
// load, mirroring the completion provider. The function is idempotent and
// guarded against HMR double-registration.
registerPluginCodeActions(monaco)

/** Monaco marker owner used for plugin-sourced diagnostics. */
const PLUGIN_MARKER_OWNER = 'snakie-plugins'

/** Debounce window (ms) before re-linting after the active file changes. */
const LINT_DEBOUNCE_MS = 400

/**
 * Paint plugin diagnostics onto a model: set Monaco markers (squiggles) and
 * record the diagnostics-with-fixes so the code-action provider can offer
 * lightbulb quick-fixes. Clears both when there are no diagnostics.
 */
function applyDiagnostics(model: monaco.editor.ITextModel, diagnostics: Diagnostic[]): void {
  const markers = diagnostics.map((d) => diagnosticToMarker(model, d))
  monaco.editor.setModelMarkers(model, PLUGIN_MARKER_OWNER, markers)
  setModelDiagnostics(model.uri.toString(), diagnostics)
}

/**
 * Map a file name to a Monaco language id. MicroPython sources are plain Python,
 * so `.py` (and unknown extensions) default to `python`.
 */
function languageForName(name: string): string {
  // The JSON language service is intentionally not bundled (see monaco-setup),
  // so `.json` opens as plaintext rather than registering an unbacked language.
  if (/\.(md|markdown)$/i.test(name)) return 'markdown'
  if (/\.(json|txt)$/i.test(name)) return 'plaintext'
  return 'python'
}

/** Read the app's authoritative theme from the document root (set by useTheme
 * on every theme change). Reading this — rather than a separate useTheme()
 * instance — guarantees the editor always matches the visible app theme. */
function readDocTheme(): string {
  return document.documentElement.getAttribute('data-theme') ?? 'dark'
}

let themesDefined = false
/** Define Monaco themes whose backgrounds match the app's palette so the editor
 * blends into the surrounding UI instead of showing Monaco's defaults. */
function ensureThemes(): void {
  if (themesDefined) return
  themesDefined = true
  monaco.editor.defineTheme('snakie-dark', {
    base: 'vs-dark',
    inherit: true,
    rules: [],
    colors: {
      'editor.background': '#14141f',
      'editorGutter.background': '#14141f',
      'minimap.background': '#14141f',
      'editorWidget.background': '#1f1f30',
      'editor.lineHighlightBackground': '#1f1f30'
    }
  })
  monaco.editor.defineTheme('snakie-light', { base: 'vs', inherit: true, rules: [], colors: {} })
  // Skeuomorph skin: cream ruled-paper editor with warm ink-on-paper syntax
  // colours (rust keywords, slate modules, plum classes, moss strings, amber
  // numbers), matching concept 08 of the MicroPython IDE Concepts design.
  monaco.editor.defineTheme('snakie-skeuomorph', {
    base: 'vs',
    inherit: true,
    rules: [
      { token: 'keyword', foreground: '8a3b2f', fontStyle: 'bold' },
      { token: 'keyword.python', foreground: '8a3b2f', fontStyle: 'bold' },
      { token: 'string', foreground: '4a6b3a' },
      { token: 'string.python', foreground: '4a6b3a' },
      { token: 'number', foreground: '9a6b2f' },
      { token: 'number.python', foreground: '9a6b2f' },
      { token: 'comment', foreground: '9a9075', fontStyle: 'italic' },
      { token: 'type', foreground: '5a4a8a' },
      { token: 'type.identifier', foreground: '5a4a8a' },
      { token: 'identifier', foreground: '2a2620' },
      { token: 'delimiter', foreground: '5a544a' }
    ],
    colors: {
      // Transparent surface so the ruled-paper background painted behind Monaco
      // (see `.lines-content` in index.css) shows through and scrolls with the
      // text; the cream base lives on the editor region body.
      'editor.background': '#00000000',
      'editorGutter.background': '#00000000',
      'editorLineNumber.foreground': '#b8ad8c',
      'editorLineNumber.activeForeground': '#8a3b2f',
      'minimap.background': '#efe9d7',
      'editorWidget.background': '#e9e3d2',
      'editor.lineHighlightBackground': '#00000000',
      'editor.selectionBackground': '#d9c79a',
      'editor.foreground': '#2a2620'
    }
  })
}

function monacoTheme(theme: string): string {
  if (theme === 'skeuomorph') return 'snakie-skeuomorph'
  if (theme === 'light') return 'snakie-light'
  return 'snakie-dark'
}

/** Editor metrics per skin. The Skeuomorph skin uses a roomy 30px line height so
 * each row sits on a ruled-paper line (the CSS gradient period must match). */
function editorMetricsFor(theme: string): { fontSize: number; lineHeight: number } {
  return theme === 'skeuomorph' ? { fontSize: 14, lineHeight: 30 } : { fontSize: 13, lineHeight: 20 }
}

/**
 * Monaco-backed code editor bound to the workspace's ACTIVE file.
 *
 *  - one Monaco model per open-file id (preserves undo history / view state
 *    when switching between files; tabs themselves are issue #4)
 *  - edits flow back through `updateContent` (which marks the buffer dirty)
 *  - Ctrl/Cmd-S triggers `saveFile` and suppresses the browser default
 *  - the editor auto-lays-out, so it tracks panel resizes
 */
export function MonacoEditor(): JSX.Element {
  const { openFiles, activeId, revealRequest, updateContent, saveFile } = useWorkspace()
  const { setDiagnostics, setLinterTool, clear: clearDiagnostics } = useDiagnostics()
  // Linting on/off (issue #65), persisted. When off the lint effect no-ops and
  // clears markers + the shared diagnostics store.
  const [lintingEnabled] = useLocalStorage<boolean>('snakie.lintingEnabled', true)

  const containerRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)
  const models = useRef(new Map<string, monaco.editor.ITextModel>())

  // Latest store callbacks, read inside Monaco event handlers without
  // re-creating the editor on every render.
  const updateContentRef = useRef(updateContent)
  const saveFileRef = useRef(saveFile)
  const activeIdRef = useRef(activeId)
  const setDiagnosticsRef = useRef(setDiagnostics)
  const setLinterToolRef = useRef(setLinterTool)
  updateContentRef.current = updateContent
  saveFileRef.current = saveFile
  activeIdRef.current = activeId
  setDiagnosticsRef.current = setDiagnostics
  setLinterToolRef.current = setLinterTool

  // Create the editor once.
  useEffect(() => {
    const container = containerRef.current
    if (!container) return undefined

    ensureThemes()
    const metrics = editorMetricsFor(readDocTheme())
    const editor = monaco.editor.create(container, {
      value: '',
      language: 'python',
      theme: monacoTheme(readDocTheme()),
      automaticLayout: true,
      lineNumbers: 'on',
      minimap: { enabled: true },
      wordWrap: 'off',
      tabSize: 4,
      insertSpaces: true,
      detectIndentation: false,
      fontFamily: "'JetBrains Mono', 'DejaVu Sans Mono', ui-monospace, monospace",
      fontSize: metrics.fontSize,
      lineHeight: metrics.lineHeight,
      letterSpacing: 0,
      scrollBeyondLastLine: false
    })
    editorRef.current = editor

    // Edits -> store (marks dirty). Guarded against programmatic model swaps via
    // the active id captured per change.
    const changeDisposable = editor.onDidChangeModelContent(() => {
      const id = activeIdRef.current
      if (!id) return
      updateContentRef.current(id, editor.getValue())
    })

    // Ctrl/Cmd-S -> save. Monaco swallows the keybinding so the browser default
    // never fires.
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      const id = activeIdRef.current
      if (id) void saveFileRef.current(id)
    })

    const modelStore = models.current
    return () => {
      changeDisposable.dispose()
      editor.dispose()
      editorRef.current = null
      modelStore.forEach((m) => {
        clearModelDiagnostics(m.uri.toString())
        m.dispose()
      })
      modelStore.clear()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Follow theme changes by observing the document root's data-theme attribute
  // (the app's single source of truth), so the editor never desyncs from the UI.
  useEffect(() => {
    const apply = (): void => {
      const docTheme = readDocTheme()
      monaco.editor.setTheme(monacoTheme(docTheme))
      // Re-apply the per-skin metrics so the notebook line height (and the
      // ruled-paper alignment) tracks theme switches, not just first paint.
      editorRef.current?.updateOptions(editorMetricsFor(docTheme))
    }
    apply()
    const observer = new MutationObserver(apply)
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme']
    })
    return () => observer.disconnect()
  }, [])

  // Bind the active file to a per-id model and attach it to the editor.
  const activeFile = openFiles.find((f) => f.id === activeId) ?? null

  useEffect(() => {
    const editor = editorRef.current
    if (!editor || !activeFile) return

    let model = models.current.get(activeFile.id)
    if (!model || model.isDisposed()) {
      model = monaco.editor.createModel(
        activeFile.content,
        languageForName(activeFile.name)
      )
      models.current.set(activeFile.id, model)
    } else if (model.getValue() !== activeFile.content) {
      // External update (e.g. reload/save round-trip) — sync without clobbering
      // the user's cursor mid-typing. Only applies when content actually drifts.
      model.setValue(activeFile.content)
    }

    if (editor.getModel() !== model) {
      editor.setModel(model)
    }
  }, [activeFile, activeFile?.id, activeFile?.content, activeFile?.name])

  // Reactive linting: when the active file's content changes (or the active
  // file switches), debounce then run all plugin linters and paint the results
  // as Monaco markers (squiggles). Stale requests are dropped via a per-run
  // token. No-ops when the plugin bridge is absent or Python wasn't found.
  useEffect(() => {
    const editor = editorRef.current
    if (!editor || !activeFile) return undefined

    const model = models.current.get(activeFile.id)
    if (!model || model.isDisposed()) return undefined

    // Linting turned off: clear any existing markers + shared diagnostics and
    // skip the host round-trip entirely.
    if (!lintingEnabled) {
      applyDiagnostics(model, [])
      clearDiagnostics()
      return undefined
    }

    const plugins = window.api?.plugins
    if (!plugins?.lint) return undefined

    let cancelled = false
    const file = activeFile
    const context: PluginContext = {
      file: {
        path: file.path,
        name: file.name,
        source: file.source,
        content: file.content
      }
    }

    const timer = setTimeout(() => {
      void (async () => {
        try {
          const status = await plugins.status()
          if (cancelled || !status.pythonFound) return
          const { diagnostics } = await plugins.lint(context)
          if (cancelled) return
          const m = models.current.get(file.id)
          if (!m || m.isDisposed()) return
          applyDiagnostics(m, diagnostics)
          // Publish to the shared store so the Problems panel mirrors the
          // squiggles painted above.
          setDiagnosticsRef.current(diagnostics)
          // Probe which linter tool the host found (drives the "install ruff"
          // hint). Only meaningful for Python files; ignore failures.
          if (/\.py$/i.test(file.name)) {
            try {
              const { actions } = await plugins.runCommand('python_linter.status', context)
              if (cancelled) return
              const msg = actions.find((a) => a.type === 'message')
              if (msg && 'text' in msg) setLinterToolRef.current(msg.text)
            } catch {
              // Status is best-effort; leave the previous value.
            }
          }
        } catch {
          // Linting must never disrupt typing; swallow + leave prior markers.
        }
      })()
    }, LINT_DEBOUNCE_MS)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [activeFile, activeFile?.id, activeFile?.content, lintingEnabled, clearDiagnostics])

  // With no active file open there is nothing to lint, so the Problems panel
  // should be empty (e.g. after closing the last tab).
  useEffect(() => {
    if (!activeFile) clearDiagnostics()
  }, [activeFile, clearDiagnostics])

  // Reveal/scroll to a line on request (e.g. clicking an Outline symbol).
  // Keyed on `seq` so repeated clicks on the same symbol re-reveal it.
  useEffect(() => {
    const editor = editorRef.current
    if (!editor || !revealRequest) return
    const line = Math.max(1, Math.floor(revealRequest.line))
    editor.revealLineInCenter(line)
    editor.setPosition({ lineNumber: line, column: 1 })
    editor.focus()
  }, [revealRequest])

  // Dispose models whose files have been closed.
  useEffect(() => {
    const openIds = new Set(openFiles.map((f) => f.id))
    models.current.forEach((model, id) => {
      if (!openIds.has(id)) {
        clearModelDiagnostics(model.uri.toString())
        model.dispose()
        models.current.delete(id)
      }
    })
  }, [openFiles])

  return (
    <div className="editor-host">
      {/* Monaco mount point. This component is lazily loaded by EditorArea only
          once at least one file is open (the "Open a file to start editing"
          empty state is rendered there, ahead of the lazy boundary), so the
          host is always visible when this renders. */}
      <div className="monaco-host" ref={containerRef} hidden={!activeFile} />
      {!activeFile && (
        <div className="editor-empty">
          <span className="editor-empty__text">Open a file to start editing</span>
        </div>
      )}
    </div>
  )
}

// Default export so EditorArea can `React.lazy(() => import('./MonacoEditor'))`,
// pushing the multi-MB Monaco chunk out of the initial renderer bundle.
export default MonacoEditor
