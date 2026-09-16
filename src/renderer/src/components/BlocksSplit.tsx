import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Panel,
  PanelGroup,
  PanelResizeHandle,
  type ImperativePanelGroupHandle
} from 'react-resizable-panels'
import { useWorkspaceLayout } from '../store/layout'
import { useWorkspace } from '../store/workspace'
import { parseBlocksFooter } from '../../../shared/blocks-doc'
import { useGraduate } from '../lib/blocks/use-graduate'
import type { GraduatedDetail } from './editorBridge'
import type { BlocksProgram } from './BlocksCanvas'
import { resolveBlocksView, type BlocksPane } from '../lib/blocks/split'
import type { BlocksViewMode } from '../store/layout'
import './BlocksSplit.css'

// Blockly is a multi-MB chunk. Code-split exactly as Monaco, DataView and
// RobotView are — a user who never opens a blocks file never downloads it,
// which matters most on the web build over a school's connection.
const BlocksCanvas = lazy(() => import('./BlocksCanvas'))
// The mirror is Monaco (#1010), which is the biggest chunk in the app. Split for
// the same reason, and so this module stays importable outside a browser — the
// conflict notice below is rendered in a plain-node test.
const PythonMirror = lazy(() => import('./PythonMirror'))

/**
 * THE BLOCKS SPLIT (#1009, epic #1007).
 * =============================================================================
 *
 * A blocks file is never *just* blocks on screen. The canvas and the Python it
 * generates sit side by side, and the workspace switcher only decides which side
 * is big — Blocks makes the canvas big, Code makes the Python big, and both
 * render this same component with nothing remounted in between, which is the
 * property `store/layout.ts` already guarantees for the shell.
 *
 * The three things this owns:
 *
 *  - **The panel group.** A nested horizontal group inside the editor region, so
 *    the tab strip above it still spans the whole width. The ratio is per
 *    workspace (`WorkspaceLayout.blocksSplit`), which is what makes pressing
 *    **Code** on a blocks file mean something.
 *  - **The emphasis.** Per file, seeded from the workspace default (epic §8 Q5),
 *    held for as long as the file is open. The `Blocks · Split · Python` control
 *    that sets it lives in the editor header, NOT the toolbar — there is exactly
 *    one global mode control and this isn't it.
 *  - **The hand-edit conflict** (#1008). A file whose footer no longer matches
 *    its Python asks which side wins before anything is written, and it asks
 *    here, because this is the component that would otherwise regenerate over
 *    the top of somebody's edit.
 *
 * Narrow windows degrade to a tab pair rather than two unusable columns — see
 * `lib/blocks/split.ts`, where the threshold is a tested number.
 */
export interface BlocksSplitProps {
  /** The emphasis to render (owned by `EditorArea`, which also renders the control). */
  mode: BlocksViewMode
  /** Set the emphasis (the tab pair in the narrow layout uses it too). */
  onModeChange: (mode: BlocksViewMode) => void
}

export function BlocksSplit({ mode, onModeChange }: BlocksSplitProps): JSX.Element {
  const { openFiles, activeId, updateBlocks } = useWorkspace()
  const layout = useWorkspaceLayout()
  const file = openFiles.find((f) => f.id === activeId) ?? null
  const content = file?.content
  const doc = useMemo(() => (content === undefined ? null : parseBlocksFooter(content)), [content])

  const hostRef = useRef<HTMLDivElement>(null)
  const groupRef = useRef<ImperativePanelGroupHandle>(null)
  const [width, setWidth] = useState(BLOCKS_INITIAL_WIDTH)
  const [pane, setPane] = useState<BlocksPane>('canvas')

  // The editor region's width decides split-or-tabs, and nothing else reports
  // it: a panel drag changes it without a window resize, and a workspace switch
  // changes it without either.
  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const observer = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width
      if (typeof w === 'number' && w > 0) setWidth(w)
    })
    observer.observe(host)
    return () => observer.disconnect()
  }, [])

  const remembered = layout.workspace.blocksSplit
  const view = useMemo(() => resolveBlocksView(mode, width, remembered), [mode, width, remembered])

  // Apply the resolved ratio to the mounted group. `applyNonce` is in the
  // dependency list because the view-mode control writes through the layout
  // store, which bumps it — the same signal a workspace switch uses.
  useEffect(() => {
    if (view.kind !== 'split') return
    groupRef.current?.setLayout([...view.ratio])
  }, [view.kind, view.ratio, layout.applyNonce])

  // A narrow layout has no handle to drag, so the tab pair is the only way
  // between the two — keep it in step with the emphasis the user last chose.
  useEffect(() => setPane(view.pane), [view.pane])

  /**
   * Fresh code to LOOK at. Held here rather than read from the file, so the
   * mirror shows what the blocks say RIGHT NOW — including while a change is
   * still only in the canvas and hasn't been written yet.
   */
  const [generated, setGenerated] = useState<BlocksProgram | null>(null)

  // A different file means the previous file's Python must not linger in the
  // mirror for the frame before the new one generates.
  useEffect(() => setGenerated(null), [file?.id])

  // ── THE LINK (#1016) ──────────────────────────────────────────────────────
  //
  // The two halves of this screen have been side by side since #1009 and the
  // map between them has existed since #1010. This is where they are joined,
  // and it is the whole pedagogical payload of the epic: point at a block, see
  // its Python; point at a line, see its block. Two things on one screen become
  // the same thing, twice.

  /** The block the mouse is over, or the one a line click selected. */
  const [linkedBlock, setLinkedBlock] = useState<string | null>(null)
  /** A block to select on the canvas, set only by a click in the Python. */
  const [selectFromPython, setSelectFromPython] = useState<string | null>(null)
  /** The block whose Python was asked for by name (right-click ▸ Show me). */
  const [pythonFor, setPythonFor] = useState<string | null>(null)

  // The lines the linked block wrote. Straight out of #1010's map, which is why
  // the issue calls this "nearly free once the source map exists".
  const linkedLines = useMemo(
    () => (linkedBlock ? (generated?.blockLines.get(linkedBlock) ?? []) : []),
    [linkedBlock, generated]
  )
  // Scroll the FIRST of them into view. Highlighting lines nobody can see is the
  // same as not highlighting them.
  const revealLine = linkedLines.length > 0 ? linkedLines[0] : null

  const handleLineClick = useCallback(
    (line: number): void => {
      const id = generated?.sourceMap.get(line) ?? null
      // A line no block wrote — an import — is not a failure to report. It is a
      // line the generator added, and saying "no block" is the honest answer.
      setLinkedBlock(id)
      setSelectFromPython(id)
    },
    [generated]
  )

  // Nothing on the old file's canvas should stay linked when another opens.
  useEffect(() => {
    setLinkedBlock(null)
    setSelectFromPython(null)
    setPythonFor(null)
  }, [file?.id])

  const handleEdit = useCallback(
    (program: BlocksProgram): void => {
      if (!file) return
      // A program the generator could not finish must never be written: it is
      // the learner's file minus whatever the missing blocks contributed, and
      // saving it would replace their program with a version that lost a step.
      if (program.missing.length > 0) return
      // Code and workspace go to the store TOGETHER — `updateBlocks` is the only
      // writer of a blocks buffer for exactly this reason (#1008).
      updateBlocks(file.id, program.code, program.workspace)
    },
    [file, updateBlocks]
  )

  // Graduating (#1016) — the same implementation the editor header's button
  // uses, because the ORDER matters (blocks kept first) and a second copy that
  // got it wrong would lose somebody's work.
  const { graduate, error: graduateError, clearError } = useGraduate(file?.id ?? null)

  if (!file || !doc) {
    return (
      <div className="blocks-split blocks-split--empty">
        <p className="blocks-split__note">No blocks file is open.</p>
      </div>
    )
  }

  const canvas = (
    <Suspense fallback={<div className="blocks-split__loading">Loading blocks…</div>}>
      <BlocksCanvas
        fileId={file.id}
        workspace={doc.workspace}
        onGenerate={setGenerated}
        onEdit={handleEdit}
        peek={view.peek}
        onExpand={() => onModeChange('split')}
        onGraduate={graduate}
        onHoverBlock={setLinkedBlock}
        onSelectBlock={setLinkedBlock}
        selectBlockId={selectFromPython}
        onShowBlockPython={setPythonFor}
      />
    </Suspense>
  )
  // The generator's output when there is any, the file's stored code until then
  // — so the pane is never blank for the frame between opening and generating.
  const mirrored = generated?.code ?? doc.code
  const python = (
    <Suspense fallback={<div className="blocks-split__loading">Loading the Python…</div>}>
      <PythonMirror
        code={mirrored}
        onEditAttempt={graduate}
        highlightLines={linkedLines}
        onLineClick={handleLineClick}
        revealLine={revealLine}
      />
    </Suspense>
  )

  return (
    <div className="blocks-split" ref={hostRef}>
      {file.blocksConflict && (
        <BlocksConflictNotice name={file.name} onKeepPython={graduate} />
      )}
      {graduateError && (
        <div className="blocks-split__conflict" role="alert">
          <p>Couldn&rsquo;t keep the blocks, so nothing was changed: {graduateError}</p>
          <button type="button" className="btn btn--sm btn--ghost" onClick={clearError}>
            Dismiss
          </button>
        </div>
      )}
      {/* "What did THIS block write?" — right-click ▸ Show me the Python. */}
      {pythonFor && generated && (
        <BlockPythonPopover
          code={generated.code}
          lines={generated.blockLines.get(pythonFor) ?? []}
          onClose={() => setPythonFor(null)}
        />
      )}

      {view.kind === 'tabs' ? (
        <div className="blocks-split__narrow">
          {/* Too narrow for two usable columns, so one at a time with a switch —
              two 180px panes are not "both on screen" (epic #903). */}
          <div className="blocks-split__tabs" role="tablist" aria-label="Blocks or Python">
            {(['canvas', 'python'] as const).map((id) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={pane === id}
                className={`blocks-split__tab${pane === id ? ' is-active' : ''}`}
                onClick={() => {
                  setPane(id)
                  onModeChange(id === 'python' ? 'python' : 'blocks')
                }}
              >
                {id === 'canvas' ? 'Blocks' : 'Python'}
              </button>
            ))}
          </div>
          {/* Both stay MOUNTED — unmounting the canvas would dispose Blockly and
              take the undo history with it every time someone looked at the code. */}
          <div className="blocks-split__pane" hidden={pane !== 'canvas'}>
            {canvas}
          </div>
          <div className="blocks-split__pane" hidden={pane !== 'python'}>
            {python}
          </div>
        </div>
      ) : (
        <PanelGroup
          direction="horizontal"
          ref={groupRef}
          className="blocks-split__group"
          onLayout={(sizes) => layout.recordSizes('blocksSplit', sizes)}
        >
          <Panel
            order={1}
            defaultSize={view.ratio[0]}
            collapsible
            collapsedSize={0}
            minSize={view.peek ? 0 : 20}
          >
            {canvas}
          </Panel>
          <PanelResizeHandle className="resize-handle resize-handle--vertical" />
          <Panel order={2} defaultSize={view.ratio[1]} minSize={20}>
            {python}
          </Panel>
        </PanelGroup>
      )}
    </div>
  )
}

/**
 * The hand-edit conflict (#1008): the Python above the footer moved, so the file
 * asks which side wins before anything is written.
 *
 * Its own component, store-free, because it is the one piece of this screen with
 * consequences — a wrong answer here loses work — and that makes it the piece
 * worth holding to its exact words in a test.
 *
 * "Keep the Python" works now. "Keep the blocks" means rebuilding the code from
 * the workspace, which IS the generator (#1010), so it is described rather than
 * offered as a button that would do nothing (epic #853: no stub that lies).
 */
export function BlocksConflictNotice({
  name,
  onKeepPython
}: {
  name: string
  onKeepPython: () => void
}): JSX.Element {
  return (
    <div className="blocks-split__conflict" role="alert">
      <h2 className="blocks-split__conflict-title">This file&rsquo;s Python was edited</h2>
      <p>
        The code in <strong>{name}</strong> no longer matches the blocks saved with it. Nothing has
        been changed — pick which one to keep.
      </p>
      <div className="blocks-split__actions">
        <button type="button" className="btn btn--sm" onClick={onKeepPython}>
          Keep the Python, drop the blocks
        </button>
      </div>
      <p className="blocks-split__hint">
        Keeping the blocks instead means rebuilding the Python from them, which arrives with the
        generator (#1010). Until then the edited code is safe here, and saving changes nothing.
      </p>
    </div>
  )
}

/**
 * Width to assume before the ResizeObserver reports (px).
 *
 * Wide enough to resolve to the split, because the alternative — starting
 * narrow — would mount the tab pair and then swap to two columns a frame later,
 * which reads as the app changing its mind in front of the user.
 */
const BLOCKS_INITIAL_WIDTH = 1200

/**
 * "Show me the Python for just this block" (#1016).
 *
 * The mirror shows the whole program and the hover already lights this block's
 * lines inside it. This answers the same question the other way round, for a
 * program long enough that the answer is off the top of the pane — and it shows
 * the lines ON THEIR OWN, which is a different thing from highlighted-in-context
 * and the thing somebody asking by name wants.
 *
 * Its own component, store-free, so the text it puts in front of a learner can
 * be held to in a test.
 */
export function BlockPythonPopover({
  code,
  lines,
  onClose
}: {
  code: string
  lines: readonly number[]
  onClose: () => void
}): JSX.Element {
  const all = code.split('\n')
  // INDENTATION, PER RUN. A block's lines are often not next to each other: the
  // toggle block owns its `pin_15.toggle()` inside a loop AND the hoisted
  // `pin_15 = Pin(...)` at the margin, and showing those two with their original
  // indentation reads as a fragment of something broken. Each contiguous run is
  // moved to the margin, so every run reads as its own little program, while
  // lines that ARE next to each other keep their relationship.
  const sorted = [...lines].sort((a, b) => a - b)
  const shown: string[] = []
  let run: number[] = []
  const flush = (): void => {
    if (run.length === 0) return
    const texts = run.map((n) => all[n - 1] ?? '')
    const indent = Math.min(
      ...texts.filter((l) => l.trim() !== '').map((l) => l.length - l.trimStart().length)
    )
    for (const l of texts) shown.push(Number.isFinite(indent) ? l.slice(indent) : l)
    run = []
  }
  for (const n of sorted) {
    if (run.length > 0 && n !== run[run.length - 1] + 1) flush()
    run.push(n)
  }
  flush()

  return (
    <div className="blocks-split__popover" role="dialog" aria-label="The Python for this block">
      <div className="blocks-split__popover-head">
        <span className="blocks-split__popover-title">This block writes</span>
        <button
          type="button"
          className="blocks-split__popover-close"
          onClick={onClose}
          aria-label="Close"
        >
          ×
        </button>
      </div>
      {shown.length > 0 ? (
        <pre className="blocks-split__popover-code">{shown.join('\n')}</pre>
      ) : (
        // A value block plugged into nothing generates no line of its own. Say
        // that, rather than showing an empty box that reads as a bug.
        <p className="blocks-split__popover-none">
          Nothing on its own — plug it into a block that does something and its
          Python appears inside that block&rsquo;s line.
        </p>
      )}
    </div>
  )
}

/**
 * The step is done, and it is an achievement (#1016).
 *
 * The obvious implementation of this moment is a confirm dialog with the word
 * "irreversible" in it, which tells a ten-year-old that what they just did was
 * dangerous. It wasn't: the blocks are saved beside the file, and they have been
 * reading this Python for an hour. So the sentence names the NUMBER instead —
 * true, checkable by scrolling, and the thing that actually happened.
 *
 * It does NOT switch workspace. Graduating and then finding yourself somewhere
 * else is the app moving the furniture while you are walking; the file is open
 * in Monaco right here, and the button OFFERS Code rather than taking it.
 *
 * Store-free and exported, so the words a learner meets at the milestone the
 * whole epic is built around are held to in a test.
 */
export function GraduationNotice({
  detail,
  onDismiss,
  onOpenInCode
}: {
  detail: GraduatedDetail
  onDismiss: () => void
  onOpenInCode?: () => void
}): JSX.Element {
  const lines = detail.lines === 1 ? '1 line' : `${detail.lines} lines`
  return (
    <div className="blocks-split__graduated" role="status">
      <h2 className="blocks-split__graduated-title">You wrote {lines} of Python.</h2>
      <p>
        <strong>{detail.name}</strong> is ordinary Python now, and you can edit it. Your blocks are
        safe in <strong>{detail.blocksName}</strong>
        {detail.blocksSaved ? ' beside it' : ', which is open and unsaved — save it to keep them'}.
      </p>
      <div className="blocks-split__actions">
        {onOpenInCode && (
          <button type="button" className="btn btn--sm" onClick={onOpenInCode}>
            Open the Code workspace
          </button>
        )}
        <button type="button" className="btn btn--sm btn--ghost" onClick={onDismiss}>
          Stay here
        </button>
      </div>
    </div>
  )
}

export default BlocksSplit
