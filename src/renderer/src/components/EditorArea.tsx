import { lazy, Suspense, useCallback, useEffect, useState } from 'react'
import { EditorTabs } from './EditorTabs'
import { FIND_EVENT } from './editorBridge'
import { ChatIcon } from './ui-icons'
import { useWorkspace } from '../store/workspace'
import { defaultBlocksViewMode, useWorkspaceLayout, type BlocksViewMode } from '../store/layout'
import { isMpyFile } from '../../../shared/mpy-info'

export interface EditorAreaProps {
  /** Whether the AI chat pane is open (drives the Chat toggle's state). */
  chatOpen?: boolean
  /** Toggle the AI chat pane. Absent (e.g. on the web) ⇒ no Chat button. The
   *  Chat toggle lives here, left of Find, rather than the console header (#…). */
  onToggleChat?: () => void
}

// Code-split Monaco: the editor (multi-MB chunk) is only loaded once a file is
// open, keeping it out of the initial renderer bundle. Until then EditorArea
// renders the lightweight empty state below.
const MonacoEditor = lazy(() => import('./MonacoEditor'))
// Data View (#274) is code-split too — only pulled in when a data file is open.
const DataView = lazy(() => import('./DataView').then((m) => ({ default: m.DataView })))
// Robot View (#311) — the three.js chunk only loads when a .urdf file is open.
const RobotView = lazy(() => import('./RobotView'))
// Bytecode View (#875) — a read-only look inside a compiled `.mpy`, in place of
// the mojibake Monaco used to show for one.
const MpyView = lazy(() => import('./MpyView'))
// Blocks split (#1008/#1009, epic #1007) — a `.py` carrying a `snakie-blocks`
// footer opens here rather than in Monaco: the canvas AND the Python it
// generates, side by side. Code-split like the rest, which is what keeps
// Blockly's multi-MB chunk off the initial load for the many users who never
// open a blocks file.
const BlocksSplit = lazy(() => import('./BlocksSplit'))

/** Files opened as a table (Data View) rather than in the code editor (#274). */
const DATA_FILE_RE = /\.(csv|tsv|tab)$/i
function isDataFile(name: string | undefined): boolean {
  return !!name && DATA_FILE_RE.test(name)
}

/** Files opened in the 3D Robot View rather than the code editor (#311). */
const ROBOT_FILE_RE = /\.urdf$/i
function isRobotFile(name: string | undefined): boolean {
  return !!name && ROBOT_FILE_RE.test(name)
}

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
export function EditorArea({ chatOpen = false, onToggleChat }: EditorAreaProps = {}): JSX.Element {
  const { openFiles, activeId } = useWorkspace()
  const layout = useWorkspaceLayout()
  const hasFiles = openFiles.length > 0
  const activeFile = openFiles.find((f) => f.id === activeId) ?? null
  const showData = isDataFile(activeFile?.name)
  const showRobot = isRobotFile(activeFile?.name)
  const showMpy = isMpyFile(activeFile?.name)
  // The one router entry that is NOT an extension test (#1008): a blocks file is
  // a `.py` on purpose, so the fact comes from the footer, read once at open
  // time and carried on the file.
  const showBlocks = activeFile?.isBlocks === true

  // The blocks emphasis is PER FILE, seeded from the workspace default (epic
  // #1007 §8 Q5): Blocks opens blocks-primary, Code opens Python-primary, and a
  // file the user has set by hand keeps their choice while it is open. Held here
  // rather than in the layout store because it belongs to the document, and not
  // persisted because it is a reading position, not a preference.
  const [modes, setModes] = useState<Record<string, BlocksViewMode>>({})
  const blocksMode = (activeId && modes[activeId]) || defaultBlocksViewMode(layout.active)
  const setBlocksMode = useCallback(
    (mode: BlocksViewMode): void => {
      if (!activeId) return
      setModes((m) => ({ ...m, [activeId]: mode }))
    },
    [activeId]
  )

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
        {showBlocks && (
          <div className="editor-header__actions">
            {/* The LOCAL mode control. It overrides the workspace emphasis for
                this file; it lives here, beside Chat and Find, rather than in
                the toolbar — the toolbar keeps exactly one global mode control
                (the workspace switcher) and this is not it. */}
            <div className="blocks-viewmode" role="group" aria-label="Blocks view">
              {BLOCKS_VIEW_LABELS.map(({ id, label, hint }) => (
                <button
                  key={id}
                  type="button"
                  className={`blocks-viewmode__btn${blocksMode === id ? ' is-active' : ''}`}
                  aria-pressed={blocksMode === id}
                  title={hint}
                  onClick={() => setBlocksMode(id)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        )}
        {(onToggleChat || (hasFiles && !showData && !showRobot && !showMpy && !showBlocks)) && (
          <div className="editor-header__actions">
            {/* Chat toggle — moved here from the console header (which was too
                busy). Sits to the LEFT of Find. Desktop + Code workspace only. */}
            {onToggleChat && (
              <button
                type="button"
                className={`btn btn--sm btn--ghost${chatOpen ? ' is-active' : ''}`}
                onClick={onToggleChat}
                title={chatOpen ? 'Hide the AI chat panel' : 'Show the AI chat panel'}
                aria-label={chatOpen ? 'Hide chat' : 'Show chat'}
                aria-pressed={chatOpen}
              >
                <span className="btn__glyph" aria-hidden="true">
                  <ChatIcon size={13} />
                </span>
                <span>Chat</span>
              </button>
            )}
            {hasFiles && !showData && !showRobot && !showMpy && !showBlocks && (
              <button
                type="button"
                className="btn btn--sm btn--ghost"
                onClick={openFind}
                title="Find & Replace (Ctrl/Cmd-F, Ctrl/Cmd-H)"
              >
                Find
              </button>
            )}
          </div>
        )}
      </div>
      <div className="region__body region__body--editor">
        {!hasFiles ? (
          <EditorPlaceholder text="Open a file to start editing" />
        ) : showData ? (
          <Suspense fallback={<EditorPlaceholder text="Loading data view…" />}>
            <DataView />
          </Suspense>
        ) : showRobot ? (
          <Suspense fallback={<EditorPlaceholder text="Loading robot view…" />}>
            <RobotView />
          </Suspense>
        ) : showBlocks ? (
          <Suspense fallback={<EditorPlaceholder text="Loading blocks…" />}>
            <BlocksSplit mode={blocksMode} onModeChange={setBlocksMode} />
          </Suspense>
        ) : showMpy ? (
          <Suspense fallback={<EditorPlaceholder text="Loading bytecode view…" />}>
            <MpyView />
          </Suspense>
        ) : (
          <Suspense fallback={<EditorPlaceholder text="Loading editor…" />}>
            <MonacoEditor />
          </Suspense>
        )}
      </div>
    </section>
  )
}

/** The three emphases, in the order the header shows them. */
const BLOCKS_VIEW_LABELS: readonly { id: BlocksViewMode; label: string; hint: string }[] = [
  { id: 'blocks', label: 'Blocks', hint: 'Make the block canvas the big one' },
  { id: 'split', label: 'Split', hint: 'Blocks and Python, half and half' },
  { id: 'python', label: 'Python', hint: 'Make the Python the big one' }
]

function EditorPlaceholder({ text }: { text: string }): JSX.Element {
  return (
    <div className="editor-host">
      <div className="editor-empty">
        <span className="editor-empty__text">{text}</span>
      </div>
    </div>
  )
}
