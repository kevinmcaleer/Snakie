import { lazy, Suspense, useCallback, useEffect, useState } from 'react'
import { EditorTabs } from './EditorTabs'
import { FindReplace } from './FindReplace'
import { getActiveEditor, FIND_EVENT, type FindEventDetail } from './editorBridge'
import { useWorkspace } from '../store/workspace'
import './FindReplace.css'

// Code-split Monaco: the editor (multi-MB chunk) is only loaded once a file is
// open, keeping it out of the initial renderer bundle. Until then EditorArea
// renders the lightweight empty state below.
const MonacoEditor = lazy(() => import('./MonacoEditor'))

/**
 * CENTER — editor region.
 *
 * Hosts the Monaco-backed code editor bound to the workspace's active file
 * (issue #3), with the tabbed strip for open files mounted above it (issue #4)
 * and a custom Find & Replace bar (issue #92) over the editor.
 *
 * Monaco is loaded lazily (issue #48): when no file is open we show a small
 * placeholder and never fetch the editor chunk; opening a file triggers the
 * dynamic import, with a matching fallback shown while it streams in.
 */
export function EditorArea(): JSX.Element {
  const { openFiles } = useWorkspace()
  const hasFiles = openFiles.length > 0

  // Find & Replace panel state (issue #92). `withReplace` distinguishes the
  // Cmd/Ctrl-F (find-only) and Cmd/Ctrl-H (find + replace) entry points.
  const [findOpen, setFindOpen] = useState(false)
  const [findWithReplace, setFindWithReplace] = useState(false)

  const openFind = useCallback((withReplace: boolean): void => {
    setFindWithReplace(withReplace)
    setFindOpen(true)
  }, [])

  const closeFind = useCallback((): void => {
    setFindOpen(false)
    getActiveEditor()?.focus()
  }, [])

  // Close the panel automatically once every file is closed (nothing to search).
  useEffect(() => {
    if (!hasFiles) setFindOpen(false)
  }, [hasFiles])

  // Open the panel when the editor fires the find shortcut (Cmd/Ctrl-F or -H).
  // The editor rebinds those keys to FIND_EVENT (overriding Monaco's own find
  // widget), so this is the primary open path when focus is in the editor.
  useEffect(() => {
    const handler = (e: Event): void => {
      if (!hasFiles) return
      openFind((e as CustomEvent<FindEventDetail>).detail.withReplace)
    }
    window.addEventListener(FIND_EVENT, handler)
    return () => window.removeEventListener(FIND_EVENT, handler)
  }, [hasFiles, openFind])

  // Cmd/Ctrl-F opens Find, Cmd/Ctrl-H opens Find + Replace. Handled in the
  // capture phase so this fires before Monaco's built-in find widget, and the
  // default is suppressed so OUR panel is the one that opens. Only active when a
  // file is open.
  const onKeyDownCapture = useCallback(
    (e: React.KeyboardEvent): void => {
      if (!hasFiles) return
      if (!(e.metaKey || e.ctrlKey) || e.altKey) return
      const key = e.key.toLowerCase()
      if (key === 'f') {
        e.preventDefault()
        e.stopPropagation()
        openFind(false)
      } else if (key === 'h') {
        e.preventDefault()
        e.stopPropagation()
        openFind(true)
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
              onClick={() => (findOpen ? closeFind() : openFind(findWithReplace))}
              aria-pressed={findOpen}
              title="Find & Replace (Ctrl/Cmd-F, Ctrl/Cmd-H)"
            >
              Find
            </button>
          </div>
        )}
      </div>
      {hasFiles && (
        <FindReplace open={findOpen} withReplace={findWithReplace} onClose={closeFind} />
      )}
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
