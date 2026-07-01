import { useEffect, useRef } from 'react'
// Import only the editor core API rather than the full `monaco-editor` barrel,
// then opt in to just the languages we render. This keeps the renderer bundle
// small instead of pulling in all ~80 bundled languages.
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api'
import 'monaco-editor/esm/vs/editor/editor.all'
import 'monaco-editor/esm/vs/basic-languages/python/python.contribution'
import 'monaco-editor/esm/vs/basic-languages/markdown/markdown.contribution'
// YAML syntax colours (issue #93). The basic-language is tokenisation-only (no
// language service / worker), so it stays within the bundle budget and the CSP.
import 'monaco-editor/esm/vs/basic-languages/yaml/yaml.contribution'
import './monaco-setup'
import { useWorkspace } from '../store/workspace'
import { useDiagnostics } from '../store/diagnostics'
import { useEditorSettings } from '../store/settings'
import { DARK_PAPER_RULES, EDITOR_THEME_LIST, monacoThemeName } from '../store/editorThemes'
import { useLocalStorage } from '../hooks/useLocalStorage'
import type { Diagnostic, PluginContext } from '../../../preload/index.d'
import { diagnosticToMarker } from './plugin-diagnostics'
import {
  clearModelDiagnostics,
  registerPluginCodeActions,
  setModelDiagnostics
} from './plugin-code-actions'
import { registerInlineCompletions } from './inline-completions'
import { setActiveEditor, dispatchOpenFind } from './editorBridge'
import { validateFormat, formatKindForName } from './format-validate'
import {
  clearFormatDiagnostics,
  registerFormatCodeActions,
  setFormatDiagnostics
} from './format-code-actions'

// Register the plugin quick-fix (lightbulb) provider exactly once at module
// load, mirroring the completion provider. The function is idempotent and
// guarded against HMR double-registration.
registerPluginCodeActions(monaco)

// Register the JSON/YAML format quick-fix provider (issue #93) once at module
// load. Idempotent + HMR-guarded; offers the "format / fix" autofix as a
// lightbulb on YAML diagnostics.
registerFormatCodeActions(monaco)

// Register the AI inline-completion (ghost text) provider exactly once at module
// load (issue #82). Idempotent + HMR-guarded; reads the enable/provider/model
// config live on each suggestion, so settings changes apply without a remount.
registerInlineCompletions(monaco)

/** Monaco marker owner used for plugin-sourced diagnostics. */
const PLUGIN_MARKER_OWNER = 'snakie-plugins'

/** Monaco marker owner used for JSON/YAML format diagnostics (issue #93). A
 * distinct owner lets format squiggles coexist with the plugin lint squiggles
 * without either clobbering the other's markers. */
const FORMAT_MARKER_OWNER = 'snakie-format'

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
 * Paint JSON/YAML format diagnostics onto a model under the dedicated format
 * marker owner, and record the diagnostics-with-fixes for the format code-action
 * provider. Clears both when there are no diagnostics.
 */
function applyFormatDiagnostics(
  model: monaco.editor.ITextModel,
  diagnostics: Diagnostic[]
): void {
  const markers = diagnostics.map((d) => diagnosticToMarker(model, d))
  monaco.editor.setModelMarkers(model, FORMAT_MARKER_OWNER, markers)
  setFormatDiagnostics(model.uri.toString(), diagnostics)
}

/**
 * Map a file name to a Monaco language id. MicroPython sources are plain Python,
 * so `.py` (and unknown extensions) default to `python`.
 */
function languageForName(name: string): string {
  // The JSON language service is intentionally not bundled (see monaco-setup),
  // so `.json` opens as plaintext rather than registering an unbacked language.
  // `.yml`/`.yaml` use the basic-language for syntax colours (issue #93).
  if (/\.(md|markdown)$/i.test(name)) return 'markdown'
  if (/\.ya?ml$/i.test(name)) return 'yaml'
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
 * blends into the surrounding UI instead of showing Monaco's defaults. The
 * Skeuomorph skin's editor colours come from the keyed editor-theme table
 * (store/editorThemes, issue #84) — one Monaco theme per entry, so adding a
 * theme there registers it here for free. */
function ensureThemes(): void {
  if (themesDefined) return
  themesDefined = true
  // Dark Skeuomorph editor (issue #91): the dark variant of the ruled-paper
  // editor. Monaco's surface is TRANSPARENT so the CSS deep-slate ruled paper
  // (`.lines-content` under `data-theme='dark'` in index.css) shows through and
  // scrolls with the text — exactly like the light Skeuomorph `paper` theme.
  // The syntax palette mirrors the Midnight editor theme so it reads legibly on
  // the dark paper, with a matching transparent gutter/line-highlight.
  monaco.editor.defineTheme('snakie-dark', {
    base: 'vs-dark',
    inherit: true,
    rules: DARK_PAPER_RULES,
    colors: {
      'editor.background': '#00000000',
      'editorGutter.background': '#00000000',
      // Lightened from #5a5f6e so inactive line numbers clear ≥3:1 on the dark
      // ruled-paper band (a11y, #188).
      'editorLineNumber.foreground': '#6e7488',
      'editorLineNumber.activeForeground': '#d6a23f',
      'minimap.background': '#1c1e24',
      'editorWidget.background': '#23262f',
      'editor.lineHighlightBackground': '#00000000',
      'editor.selectionBackground': '#3a4258',
      'editor.foreground': '#d4d8e0'
    }
  })
  monaco.editor.defineTheme('snakie-light', { base: 'vs', inherit: true, rules: [], colors: {} })
  // Skeuomorph editor colour themes (issue #84): Paper (warm cream), Bright
  // (whiter paper, vivid syntax) and Midnight (dark). Paper themes keep a
  // transparent surface so the CSS ruled-paper (`.lines-content` in index.css)
  // shows through; an opaque theme paints its own background and the ruled lines
  // are hidden by the matching `data-editor-theme` CSS branch.
  for (const def of EDITOR_THEME_LIST) {
    monaco.editor.defineTheme(monacoThemeName(def.id), {
      base: def.paper ? 'vs' : 'vs-dark',
      inherit: true,
      rules: def.rules,
      colors: {
        'editor.background': def.monaco.background,
        'editorGutter.background': def.monaco.gutterBackground,
        'editorLineNumber.foreground': def.monaco.lineNumber,
        'editorLineNumber.activeForeground': def.monaco.lineNumberActive,
        'minimap.background': def.monaco.minimap,
        'editorWidget.background': def.monaco.widget,
        'editor.lineHighlightBackground': def.monaco.lineHighlight,
        'editor.selectionBackground': def.monaco.selection,
        'editor.foreground': def.monaco.foreground
      }
    })
  }
}

/** Resolve the app skin + editor-theme id to the Monaco theme name. The
 * Skeuomorph skin (shown as "Light") uses the user-selected editor colour theme;
 * the Dark theme (issue #91) uses `snakie-dark`, the dark ruled-paper theme
 * (transparent surface so the CSS deep-slate paper shows through). */
function monacoTheme(theme: string, editorTheme: string): string {
  if (theme === 'skeuomorph') return monacoThemeName(editorTheme)
  return 'snakie-dark'
}

/** Read the user's editor colour-theme id from the document root (set by the
 * settings store), so the create/observe effects can resolve the Monaco theme
 * without a fresh useEditorSettings() instance racing the attribute. */
function readEditorTheme(): string {
  return document.documentElement.getAttribute('data-editor-theme') ?? 'paper'
}

/** Editor metrics per skin. Both Skeuomorph skins (light + the dark variant,
 * issue #91) sit the text on ruled-paper lines, so their line height tracks the
 * user's configured spacing (issues #80/#81) — which must equal the CSS gradient
 * period (`--editor-rule-spacing`) for the text to land on the lines. The plain
 * `light` skin keeps fixed metrics. */
function editorMetricsFor(
  theme: string,
  lineSpacing: number
): { fontSize: number; lineHeight: number } {
  return theme === 'skeuomorph' || theme === 'dark'
    ? { fontSize: 14, lineHeight: lineSpacing }
    : { fontSize: 13, lineHeight: 20 }
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
  // Notebook line spacing (issues #80/#81) — drives Monaco's line height to match
  // the ruled-paper CSS period.
  const { lineSpacing, editorTheme } = useEditorSettings()
  // Linting on/off (issue #65), persisted. When off the lint effect no-ops and
  // clears markers + the shared diagnostics store.
  const [lintingEnabled] = useLocalStorage<boolean>('snakie.lintingEnabled', true)

  const containerRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)
  const models = useRef(new Map<string, monaco.editor.ITextModel>())
  // Latest spacing, read inside the create + theme-change effects without
  // re-creating the editor.
  const lineSpacingRef = useRef(lineSpacing)
  lineSpacingRef.current = lineSpacing

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
    const metrics = editorMetricsFor(readDocTheme(), lineSpacingRef.current)
    const editor = monaco.editor.create(container, {
      value: '',
      language: 'python',
      theme: monacoTheme(readDocTheme(), readEditorTheme()),
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
      scrollBeyondLastLine: false,
      // Disable sticky scroll: the pinned scope/function header overlaps and
      // clashes with the code beneath it on the ruled-paper editor (user report).
      stickyScroll: { enabled: false },
      // AI ghost text (issue #82). The registered provider gates itself on the
      // enable toggle + a stored key, so leaving this on costs nothing when the
      // feature is off.
      inlineSuggest: { enabled: true }
    })
    editorRef.current = editor
    // Publish this instance to the editor-access seam (issue #92) so the Find &
    // Replace panel can drive Monaco's search/edit APIs imperatively.
    setActiveEditor(editor)

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

    // Ctrl/Cmd-F + Ctrl/Cmd-H -> the custom Find & Replace panel (issue #92).
    // Rebinding the keys at the editor level overrides Monaco's built-in find
    // widget, so OUR panel (in EditorArea, listening for FIND_EVENT) is what
    // opens. F = find-only, H = find + replace.
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyF, () => dispatchOpenFind(false))
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyH, () => dispatchOpenFind(true))

    const modelStore = models.current
    return () => {
      changeDisposable.dispose()
      setActiveEditor(null)
      editor.dispose()
      editorRef.current = null
      modelStore.forEach((m) => {
        clearModelDiagnostics(m.uri.toString())
        clearFormatDiagnostics(m.uri.toString())
        m.dispose()
      })
      modelStore.clear()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Follow theme changes by observing the document root's data-theme +
  // data-editor-theme attributes (the app's single source of truth), so the
  // editor never desyncs from the UI or the selected editor colour theme.
  useEffect(() => {
    const apply = (): void => {
      const docTheme = readDocTheme()
      monaco.editor.setTheme(monacoTheme(docTheme, readEditorTheme()))
      // Re-apply the per-skin metrics so the notebook line height (and the
      // ruled-paper alignment) tracks theme switches, not just first paint.
      editorRef.current?.updateOptions(editorMetricsFor(docTheme, lineSpacingRef.current))
    }
    apply()
    const observer = new MutationObserver(apply)
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme', 'data-editor-theme']
    })
    return () => observer.disconnect()
  }, [])

  // Re-apply the Monaco theme when the user picks a different editor colour
  // theme (issue #84). The observer above also catches the data-attribute flip,
  // but reacting to the store value too keeps the editor instant + deterministic.
  useEffect(() => {
    editorRef.current && monaco.editor.setTheme(monacoTheme(readDocTheme(), editorTheme))
  }, [editorTheme])

  // Follow ruled-line spacing changes (Settings dialog, issues #80/#81) so the
  // editor's line height stays equal to the CSS ruled-paper period.
  useEffect(() => {
    editorRef.current?.updateOptions(editorMetricsFor(readDocTheme(), lineSpacing))
  }, [lineSpacing])

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

    // JSON/YAML files are validated by the format effect below, which owns the
    // shared diagnostics store for them. Skip the Python plugin lint path so it
    // can't clobber the format diagnostics in the single-active-file store.
    if (formatKindForName(activeFile.name)) {
      applyDiagnostics(model, [])
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

  // Reactive JSON/YAML validation (issue #93): when the active file is a
  // `.json`/`.yml`/`.yaml` file, debounce then run the pure `validateFormat`,
  // paint the result under the dedicated format marker owner (squiggles +
  // lightbulb), and publish to the shared store so the Problems panel lists
  // them. Clears them when the content is valid, or when switching to a
  // non-format file. Runs entirely in the renderer (no host round-trip).
  useEffect(() => {
    const editor = editorRef.current
    if (!editor || !activeFile) return undefined

    const model = models.current.get(activeFile.id)
    if (!model || model.isDisposed()) return undefined

    // Not a format file: clear any prior format markers/diagnostics and let the
    // plugin lint effect own the Problems panel.
    if (!formatKindForName(activeFile.name)) {
      applyFormatDiagnostics(model, [])
      return undefined
    }

    const file = activeFile
    const timer = setTimeout(() => {
      const m = models.current.get(file.id)
      if (!m || m.isDisposed()) return
      const diagnostics = validateFormat(file.name, file.content)
      applyFormatDiagnostics(m, diagnostics)
      // Publish to the shared store so the Problems panel mirrors the squiggles.
      setDiagnosticsRef.current(diagnostics)
      // Format files have no linter-tool concept; clear the "install ruff" hint.
      setLinterToolRef.current(null)
    }, LINT_DEBOUNCE_MS)

    return () => clearTimeout(timer)
  }, [activeFile, activeFile?.id, activeFile?.content, activeFile?.name])

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
        clearFormatDiagnostics(model.uri.toString())
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
