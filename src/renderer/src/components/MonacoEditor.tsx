import { useEffect, useRef } from 'react'
// Import only the editor core API rather than the full `monaco-editor` barrel,
// then opt in to just the languages we render. This keeps the renderer bundle
// small instead of pulling in all ~80 bundled languages.
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api'
import 'monaco-editor/esm/vs/editor/editor.all'
import 'monaco-editor/esm/vs/basic-languages/python/python.contribution'
import 'monaco-editor/esm/vs/basic-languages/markdown/markdown.contribution'
import 'monaco-editor/esm/vs/language/json/monaco.contribution'
import './monaco-setup'
import { useWorkspace } from '../store/workspace'
import { useTheme } from '../hooks/useTheme'

/**
 * Map a file name to a Monaco language id. MicroPython sources are plain Python,
 * so `.py` (and unknown extensions) default to `python`.
 */
function languageForName(name: string): string {
  if (/\.(json)$/i.test(name)) return 'json'
  if (/\.(md|markdown)$/i.test(name)) return 'markdown'
  if (/\.(txt)$/i.test(name)) return 'plaintext'
  return 'python'
}

function monacoTheme(theme: 'light' | 'dark'): string {
  return theme === 'dark' ? 'vs-dark' : 'vs'
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
  const { openFiles, activeId, updateContent, saveFile } = useWorkspace()
  const { theme } = useTheme()

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

    const editor = monaco.editor.create(container, {
      value: '',
      language: 'python',
      theme: monacoTheme(theme),
      automaticLayout: true,
      lineNumbers: 'on',
      minimap: { enabled: true },
      wordWrap: 'off',
      tabSize: 4,
      insertSpaces: true,
      detectIndentation: false,
      fontFamily:
        'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
      fontSize: 13,
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

  // Follow theme changes.
  useEffect(() => {
    monaco.editor.setTheme(monacoTheme(theme))
  }, [theme])

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
      {/* The Monaco mount point is always present so the editor instance can be
          created on first mount regardless of whether a file is open yet. */}
      <div className="monaco-host" ref={containerRef} hidden={!activeFile} />
      {!activeFile && (
        <div className="editor-empty">
          <span className="editor-empty__text">Open a file to start editing</span>
        </div>
      )}
    </div>
  )
}
