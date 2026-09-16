import { lazy, Suspense, useCallback, useEffect, useState } from 'react'
import { EditorTabs } from './EditorTabs'
import { BLOCKS_VIEW_EVENT, FIND_EVENT, type BlocksViewDetail } from './editorBridge'
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
// The Blocks workspace's empty state (#1013): the only place in the app that can
// CREATE a blocks program, so picking Blocks with nothing open is a door rather
// than a dead end. Small and not code-split — it is what the workspace shows
// first, and it must not wait on a chunk.
const BlocksStart = lazy(() => import('./BlocksStart'))

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
  const { setBlocksBoth } = layout
  const hasFiles = openFiles.length > 0
  const activeFile = openFiles.find((f) => f.id === activeId) ?? null
  const showData = isDataFile(activeFile?.name)
  const showRobot = isRobotFile(activeFile?.name)
  const showMpy = isMpyFile(activeFile?.name)
  // The one router entry that is NOT an extension test (#1008): a blocks file is
  // a `.py` on purpose, so the fact comes from the footer, read once at open
  // time and carried on the file.
  /**
   * Show the blocks split for this file?
   *
   * A file with a blocks footer, anywhere — that has been true since #1008. And
   * (#1034) **any Python file at all, in the Blocks workspace**: the `.py` is the
   * program and the blocks are a view of it, so pressing Blocks on a file Snakie
   * did not write now shows you blocks rather than appearing to ignore you.
   */
  const showBlocks =
    activeFile?.isBlocks === true ||
    (layout.active === 'blocks' && /\.py$/i.test(activeFile?.name ?? ''))

  // The blocks emphasis is PER FILE, seeded from the workspace default (epic
  // #1007 §8 Q5): Blocks opens blocks-primary, Code opens Python-primary, and a
  // file the user has set by hand keeps their choice while it is open. Held here
  // rather than in the layout store because it belongs to the document, and not
  // persisted because it is a reading position, not a preference.
  const [modes, setModes] = useState<Record<string, BlocksViewMode>>({})
  const blocksMode =
    (activeId && modes[activeId]) || defaultBlocksViewMode(layout.active, layout.blocksBoth)
  /**
   * The emphasis changed — from the divider, or from the switcher's dot (#1053).
   *
   * THE TWO STAY IN STEP, which is the whole reason this pushes back into the
   * layout store. The divider is the control (#1034) and the dot is its visible
   * twin; a divider dragged to an end while the dot stayed lit would leave the
   * switcher describing a screen that is not there.
   */
  const setBlocksMode = useCallback(
    (mode: BlocksViewMode): void => {
      if (activeId) setModes((m) => ({ ...m, [activeId]: mode }))
      setBlocksBoth(mode === 'split')
    },
    [activeId, setBlocksBoth]
  )

  // The dot is workspace-level and the emphasis is per file, so a file the
  // learner has set by hand would otherwise ignore the dot they just pressed.
  // Pressing it clears the override and lets the workspace answer again.
  useEffect(() => {
    if (!activeId) return
    setModes((m) => (activeId in m ? Object.fromEntries(
      Object.entries(m).filter(([id]) => id !== activeId)
    ) : m))
    // Only when the DOT changes — not on every file switch, which would throw
    // away an emphasis the learner set for a file they are still looking at.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout.blocksBoth])

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

  // A lesson asked for an emphasis (#1016).
  //
  // Held as PENDING and resolved by name, because the lesson dispatches this
  // right after opening its buffer — before React has made that buffer active.
  // Applying it to "the active file" there would key it to the lesson before,
  // and the handover lesson would open in the ordinary split with nothing to
  // say why.
  const [pendingMode, setPendingMode] = useState<BlocksViewDetail | null>(null)
  useEffect(() => {
    const handler = (e: Event): void => {
      const detail = (e as CustomEvent<BlocksViewDetail>).detail
      if (detail?.name) setPendingMode(detail)
    }
    window.addEventListener(BLOCKS_VIEW_EVENT, handler)
    return () => window.removeEventListener(BLOCKS_VIEW_EVENT, handler)
  }, [])
  useEffect(() => {
    if (!pendingMode) return
    const target = openFiles.find((f) => f.name === pendingMode.name)
    if (!target) return
    const mode = pendingMode.mode
    if (mode === 'blocks' || mode === 'split' || mode === 'python') {
      setModes((m) => ({ ...m, [target.id]: mode }))
    }
    setPendingMode(null)
  }, [pendingMode, openFiles])

  return (
    <section
      className="region region--editor"
      aria-label="Editor"
      onKeyDownCapture={onKeyDownCapture}
    >
      <div className="editor-header">
        <EditorTabs />
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
          // In the Blocks workspace an empty editor is an opportunity, not a
          // gap: it is where the "Draw a square" starter and "new blocks
          // program" live (#1013). Everywhere else the plain placeholder is
          // right — offering to make a blocks file from the Code workspace
          // would be answering a question nobody asked.
          layout.active === 'blocks' ? (
            <Suspense fallback={<EditorPlaceholder text="Loading…" />}>
              <BlocksStart />
            </Suspense>
          ) : (
            <EditorPlaceholder text="Open a file to start editing" />
          )
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

function EditorPlaceholder({ text }: { text: string }): JSX.Element {
  return (
    <div className="editor-host">
      <div className="editor-empty">
        <span className="editor-empty__text">{text}</span>
      </div>
    </div>
  )
}
