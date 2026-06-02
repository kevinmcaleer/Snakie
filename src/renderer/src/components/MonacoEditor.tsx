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
function readDocTheme(): 'light' | 'dark' {
  return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark'
}

let themesDefined = false
/** Define Monaco themes whose backgrounds match the app's NES palette so the
 * editor blends into the dark UI instead of showing Monaco's default colours. */
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
}

function monacoTheme(theme: 'light' | 'dark'): string {
  return theme === 'dark' ? 'snakie-dark' : 'snakie-light'
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

  const containerRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)
  const models = useRef(new Map<string, monaco.editor.ITextModel>())

  // Latest store callbacks, read inside Monaco event handlers without
  // re-creating the editor on every render.
  const updateContentRef = useRef(updateContent)
  const saveFileRef = useRef(saveFile)
  const activeIdRef = useRef(activeId)
  updateContentRef.current = updateContent
  saveFileRef.current = saveFile
  activeIdRef.current = activeId

  // Create the editor once.
  useEffect(() => {
    const container = containerRef.current
    if (!container) return undefined

    ensureThemes()
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
      fontSize: 13,
      lineHeight: 20,
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
      modelStore.forEach((m) => m.dispose())
      modelStore.clear()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Follow theme changes by observing the document root's data-theme attribute
  // (the app's single source of truth), so the editor never desyncs from the UI.
  useEffect(() => {
    const apply = (): void => monaco.editor.setTheme(monacoTheme(readDocTheme()))
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
