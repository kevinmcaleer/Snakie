import { useEffect } from 'react'
import { useWorkspace } from '../store/workspace'
import './EditorTabs.css'

/**
 * Tab strip for the editor region (issue #4).
 *
 * Lists every open file as a tab; the active tab is highlighted and clicking a
 * tab activates it. Each tab carries a dirty indicator and a close (×) button
 * that confirms before discarding unsaved edits. A trailing `+` button creates
 * a new untitled buffer (VS Code muscle memory).
 *
 * Keyboard:
 *   - Ctrl/Cmd+W           closes the active tab
 *   - Ctrl+Tab             cycles to the next tab
 *   - Ctrl+Shift+Tab       cycles to the previous tab
 */
export function EditorTabs(): JSX.Element | null {
  const { openFiles, activeId, setActive, closeFile, newFile } = useWorkspace()

  // Close a tab, confirming first if it has unsaved edits.
  function requestClose(id: string): void {
    const file = openFiles.find((f) => f.id === id)
    if (file?.dirty) {
      const ok = window.confirm(`"${file.name}" has unsaved changes. Close it anyway?`)
      if (!ok) return
    }
    closeFile(id)
  }

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent): void {
      const mod = e.ctrlKey || e.metaKey
      if (!mod) return

      // Ctrl/Cmd+W -> close the active tab.
      if ((e.key === 'w' || e.key === 'W') && !e.shiftKey) {
        if (!activeId) return
        e.preventDefault()
        requestClose(activeId)
        return
      }

      // Ctrl+Tab / Ctrl+Shift+Tab -> cycle tabs.
      if (e.key === 'Tab') {
        if (openFiles.length === 0) return
        e.preventDefault()
        const idx = openFiles.findIndex((f) => f.id === activeId)
        const base = idx === -1 ? 0 : idx
        const len = openFiles.length
        const nextIdx = e.shiftKey ? (base - 1 + len) % len : (base + 1) % len
        setActive(openFiles[nextIdx].id)
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openFiles, activeId, setActive, closeFile])

  if (openFiles.length === 0) {
    // Thin empty-state bar keeps the layout stable and still offers a `+`.
    return (
      <div className="editor-tabs editor-tabs--empty" role="tablist" aria-label="Open files">
        <button
          type="button"
          className="editor-tabs__new"
          title="New file"
          aria-label="New file"
          onClick={newFile}
        >
          +
        </button>
      </div>
    )
  }

  return (
    <div className="editor-tabs" role="tablist" aria-label="Open files">
      {openFiles.map((file) => {
        const active = file.id === activeId
        return (
          <div
            key={file.id}
            role="tab"
            aria-selected={active}
            className={`editor-tab${active ? ' editor-tab--active' : ''}`}
            onClick={() => setActive(file.id)}
            onMouseDown={(e) => {
              // Middle-click closes, matching common editor behaviour.
              if (e.button === 1) {
                e.preventDefault()
                requestClose(file.id)
              }
            }}
            title={file.path || file.name}
          >
            {file.dirty && <span className="editor-tab__dirty" aria-hidden="true" />}
            <span className="editor-tab__label">{file.name}</span>
            <button
              type="button"
              className="editor-tab__close"
              title="Close"
              aria-label={`Close ${file.name}`}
              onClick={(e) => {
                e.stopPropagation()
                requestClose(file.id)
              }}
            >
              ×
            </button>
          </div>
        )
      })}
      <button
        type="button"
        className="editor-tabs__new"
        title="New file"
        aria-label="New file"
        onClick={newFile}
      >
        +
      </button>
    </div>
  )
}
