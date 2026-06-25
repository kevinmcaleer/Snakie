import { lazy, Suspense, useCallback, useEffect } from 'react'
import { EditorTabs } from './EditorTabs'
import { FIND_EVENT } from './editorBridge'
import { useWorkspace } from '../store/workspace'

// Code-split Monaco: the editor (multi-MB chunk) is only loaded once a file is
// open, keeping it out of the initial renderer bundle. Until then EditorArea
// renders the lightweight empty state below.
const MonacoEditor = lazy(() => import('./MonacoEditor'))

/**
 * CENTER — editor region.
 *
 * Hosts the Monaco-backed code editor bound to the workspace's active file
 * (issue #3), with the tabbed strip for open files mounted above it (issue #4).
 * Find & Replace opens in its own native window (issue #146) — the "Find" button
 * in the tab header and Cmd/Ctrl-F / Cmd/Ctrl-H both just open that window.
 *
 * Monaco is loaded lazily (issue #48): when no file is open we show a small
 * placeholder and never fetch the editor chunk; opening a file triggers the
 * dynamic import, with a matching fallback shown while it streams in.
 */
export function EditorArea(): JSX.Element {
  const { openFiles } = useWorkspace()
  const hasFiles = openFiles.length > 0

  // Open the Find & Replace window. The window itself drives the editor over IPC
  // (issue #146); we only need to open/focus it.
  const openFind = useCallback((): void => {
    if (!hasFiles) return
    void window.api.find.open()
  }, [hasFiles])

  // Open the window when the editor fires the find shortcut (Cmd/Ctrl-F or -H).
  // MonacoEditor rebinds those keys to FIND_EVENT (overriding Monaco's own find
  // widget), so this is the primary open path when focus is in the editor.
  useEffect(() => {
    const handler = (): void => openFind()
    window.addEventListener(FIND_EVENT, handler)
    return () => window.removeEventListener(FIND_EVENT, handler)
  }, [openFind])

  // Cmd/Ctrl-F / Cmd/Ctrl-H also open the window when focus is outside Monaco
  // (e.g. in the tab strip). Captured so the default is suppressed first.
  const onKeyDownCapture = useCallback(
    (e: React.KeyboardEvent): void => {
      if (!hasFiles) return
      if (!(e.metaKey || e.ctrlKey) || e.altKey) return
      const key = e.key.toLowerCase()
      if (key === 'f' || key === 'h') {
        e.preventDefault()
        e.stopPropagation()
        openFind()
      }
    },
    [hasFiles, openFind]
  )

  return (
    <section
      className="region region--editor"
      aria-label="Editor"
      onKeyDownCapture={onKeyDownCapture}
    >
      <div className="editor-header">
        <EditorTabs />
        {hasFiles && (
          <div className="editor-header__actions">
            <button
              type="button"
              className="btn btn--sm btn--ghost"
              onClick={openFind}
              title="Find & Replace (Ctrl/Cmd-F, Ctrl/Cmd-H)"
            >
              Find
            </button>
          </div>
        )}
      </div>
      <div className="region__body region__body--editor">
        {hasFiles ? (
          <Suspense fallback={<EditorPlaceholder text="Loading editor…" />}>
            <MonacoEditor />
          </Suspense>
        ) : (
          <EditorPlaceholder text="Open a file to start editing" />
        )}
      </div>
    </section>
  )
}

function EditorPlaceholder({ text }: { text: string }): JSX.Element {
  return (
    <div className="editor-host">
      <div className="editor-empty">
        <span className="editor-empty__text">{text}</span>
      </div>
    </div>
  )
}
