import { lazy, Suspense } from 'react'
import { EditorTabs } from './EditorTabs'
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
 *
 * Monaco is loaded lazily (issue #48): when no file is open we show a small
 * placeholder and never fetch the editor chunk; opening a file triggers the
 * dynamic import, with a matching fallback shown while it streams in.
 */
export function EditorArea(): JSX.Element {
  const { openFiles } = useWorkspace()
  const hasFiles = openFiles.length > 0

  return (
    <section className="region region--editor" aria-label="Editor">
      <EditorTabs />
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
