import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Panel,
  PanelGroup,
  PanelResizeHandle,
  type ImperativePanelGroupHandle
} from 'react-resizable-panels'
import { useWorkspaceLayout } from '../store/layout'
import { useWorkspace } from '../store/workspace'
import { BLOCKS_SCHEMA_VERSION, parseBlocksFooter } from '../../../shared/blocks-doc'
import { pythonToBlocks } from '../lib/blocks/python-to-blocks'
import { syntaxOk, type DeviceExec } from '../lib/blocks/syntax-gate'
import { verifyConversion, type ConversionHold } from '../lib/blocks/round-trip'
import { PROGRAM_RUN_EVENT, type ProgramRunDetail } from './editorBridge'
import { useDeviceStatus } from '../hooks/useDeviceStatus'
import { useDynamicBlocks } from '../lib/blocks/use-dynamic-blocks'
import { DriverInstallBanner } from './DriverInstallBanner'
import type { PartDriverNeed } from './part-editor.util'
import type { BlocksProgram } from './BlocksCanvas'
import {
  modeForRatio,
  resolveBlocksView,
  stopFor,
  type BlocksPane
} from '../lib/blocks/split'
import type { BlocksViewMode } from '../store/layout'
import './BlocksSplit.css'

// Blockly is a multi-MB chunk. Code-split exactly as Monaco, DataView and
// RobotView are — a user who never opens a blocks file never downloads it,
// which matters most on the web build over a school's connection.
const BlocksCanvas = lazy(() => import('./BlocksCanvas'))

/**
 * How long after the last keystroke the code is turned back into blocks (ms).
 *
 * Long enough that typing a line is one conversion rather than thirty, short
 * enough that pausing to think shows you what you just wrote. The canvas
 * rebuild is the expensive half, and it is also the one that would be
 * distracting if it happened per character.
 */
const CODE_TO_BLOCKS_MS = 450


// The code pane is Monaco (#1010), which is the biggest chunk in the app. Split
// for the same reason, and so this module stays importable outside a browser.
const PythonPane = lazy(() => import('./PythonPane'))

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
  const { openFiles, activeId, updateBlocks, currentFolder } = useWorkspace()
  const layout = useWorkspaceLayout()
  const file = openFiles.find((f) => f.id === activeId) ?? null
  const content = file?.content
  /**
   * The document, as blocks and as code.
   *
   * A file with a footer brings its own workspace — the blocks exactly where the
   * learner left them. A file WITHOUT one is converted (#1019, #1034): the `.py`
   * is the program, and the blocks are a view of it, so any MicroPython file can
   * be opened here rather than only the ones Snakie wrote.
   */
  const doc = useMemo(() => {
    if (content === undefined) return null
    const stored = parseBlocksFooter(content)
    if (stored) return stored
    const { workspace } = pythonToBlocks(content)
    return { code: content, workspace, version: BLOCKS_SCHEMA_VERSION, codeMatches: true }
  }, [content])

  const hostRef = useRef<HTMLDivElement>(null)
  const groupRef = useRef<ImperativePanelGroupHandle>(null)
  const [width, setWidth] = useState(BLOCKS_INITIAL_WIDTH)
  const [pane, setPane] = useState<BlocksPane>('canvas')
  /** Where the divider is, read on release to find the stop it fell into. */
  const ratioRef = useRef<[number, number]>([50, 50])
  /** The same number as state, so the detent marker can light up as you near it. */
  const [canvasShare, setCanvasShare] = useState(50)

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

  // Apply the resolved ratio to the mounted group, when the STOP changes or a
  // workspace switch asks for it (`applyNonce`).
  //
  // Keyed on `mode` and NOT on `view.ratio`, which is a fresh array from
  // `resolveBlocksView` on every render. Depending on it re-applied the layout
  // on each render — and since a drag re-renders (the detent marker follows the
  // divider), the effect undid the drag frame by frame and the divider could
  // not be moved at all.
  const viewRatioRef = useRef(view.ratio)
  viewRatioRef.current = view.ratio
  useEffect(() => {
    if (view.kind !== 'split') return
    groupRef.current?.setLayout([...viewRatioRef.current])
  }, [view.kind, mode, layout.applyNonce])

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
  /**
   * Bumped on EVERY line click, even one that names the block already named
   * (#1050).
   *
   * Without it, clicking the same line twice did nothing: React sees the same
   * id and skips the update, so the canvas never re-asserts — and by then
   * clicking into the code pane has moved focus out of the canvas, which is how
   * Blockly clears a selection. The learner clicked a line and watched nothing
   * light up.
   */
  const [selectNonce, setSelectNonce] = useState(0)
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
      // Always, so pointing at the same line twice still answers.
      setSelectNonce((n) => n + 1)
    },
    [generated]
  )

  // Nothing on the old file's canvas should stay linked when another opens.
  useEffect(() => {
    setLinkedBlock(null)
    setSelectFromPython(null)
    setPythonFor(null)
  }, [file?.id])

  /**
   * WHO IS DRIVING (#1034).
   *
   * Blocks and code are two views of one program, so both can be edited — but
   * only one of them at a time is the thing being edited, and the other has to
   * follow without arguing. While the learner is typing, this holds their exact
   * text and the pane shows it; the canvas follows along underneath. The moment
   * they touch a block, it clears and the generator takes the wheel back.
   *
   * Without it the two halves fight: a keystroke converts to blocks, the blocks
   * regenerate code, and the regenerated code — which is tidied, with its
   * imports re-sorted — lands back in the pane under the cursor, mid-word.
   */
  const [codeDraft, setCodeDraft] = useState<string | null>(null)
  /** Bumped when a CODE edit rebuilt the workspace, so the canvas re-reads it. */
  const [reloadNonce, setReloadNonce] = useState(0)
  const codeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  /**
   * The conversion was held back by the round-trip gate (#1068), and why.
   *
   * Null the rest of the time, which is almost always. When it is set, the
   * canvas is showing blocks from BEFORE the learner's last edit — which is a
   * thing they are entitled to be told, quietly, rather than left to notice.
   */
  const [heldBack, setHeldBack] = useState<ConversionHold | null>(null)

  // ── THE PARSE GATE (#1037) ────────────────────────────────────────────────
  //
  // Whether the board is worth asking. `exec` goes through the raw REPL, which
  // INTERRUPTS whatever the board is doing — so a running program means we use
  // the lint instead, every time. Killing a learner's blink loop every 450ms to
  // tidy up a canvas would be an appalling trade.
  const deviceStatus = useDeviceStatus()
  const [programRunning, setProgramRunning] = useState(false)
  useEffect(() => {
    const handler = (e: Event): void => {
      setProgramRunning(!!(e as CustomEvent<ProgramRunDetail>).detail?.running)
    }
    window.addEventListener(PROGRAM_RUN_EVENT, handler)
    return () => window.removeEventListener(PROGRAM_RUN_EVENT, handler)
  }, [])
  const askBoard: DeviceExec | null = useMemo(() => {
    if (programRunning) return null
    if (deviceStatus.state !== 'connected') return null
    const exec = window.api?.device?.exec
    return exec ? (code: string) => exec(code) : null
  }, [programRunning, deviceStatus.state])
  const askBoardRef = useRef(askBoard)
  askBoardRef.current = askBoard
  /** Guards against a slow probe landing after a newer one (#1037). */
  const gateSeq = useRef(0)
  useEffect(() => {
    setCodeDraft(null)
    setHeldBack(null)
  }, [file?.id])
  useEffect(
    () => () => {
      if (codeTimer.current) clearTimeout(codeTimer.current)
    },
    []
  )

  const handleEdit = useCallback(
    (program: BlocksProgram): void => {
      if (!file) return
      // A program the generator could not finish must never be written: it is
      // the learner's file minus whatever the missing blocks contributed, and
      // saving it would replace their program with a version that lost a step.
      if (program.missing.length > 0) return
      // A block was dragged, so the blocks are what is being edited now — and
      // whatever the code pane could not be converted into is no longer the
      // question (#1068).
      setCodeDraft(null)
      setHeldBack(null)
      // Code and workspace go to the store TOGETHER — `updateBlocks` is the only
      // writer of a blocks buffer for exactly this reason (#1008).
      updateBlocks(file.id, program.code, program.workspace)
    },
    [file, updateBlocks]
  )

  /**
   * The learner typed in the code pane (#1034). Convert it back into blocks.
   *
   * DEBOUNCED, because every keystroke is a change and a program is not: half a
   * line converts to something very different from the finished one, and a
   * canvas rebuilding itself on each character would be unusable. Their text
   * appears instantly; the blocks catch up when they pause.
   *
   * The conversion cannot fail (#1019) — a line nothing recognises becomes a raw
   * Python block holding that exact line — so there is nothing to validate and
   * nothing to refuse.
   */
  const handleCodeChange = useCallback(
    (code: string): void => {
      if (!file) return
      setCodeDraft(code)
      if (codeTimer.current) clearTimeout(codeTimer.current)
      codeTimer.current = setTimeout(() => {
        const seq = (gateSeq.current += 1)
        void syntaxOk(code, { exec: askBoardRef.current })
          .then(async (verdict) => {
            // A probe that came back after the learner typed again is answering a
            // question about text that no longer exists.
            if (seq !== gateSeq.current) return
            // Mid-sentence. Their text stays exactly as typed (`codeDraft` still
            // holds it) and the blocks they already have stay on screen. No
            // warning: a program half written is not a program with a mistake.
            if (!verdict.ok) return
            const { workspace } = pythonToBlocks(code)
            // ── THE ROUND-TRIP GATE (#1068) ─────────────────────────────────
            //
            // Committing this makes the blocks the source of truth, and the next
            // block the learner touches regenerates the file from them. So the
            // question is not "did we convert it" but "would regenerating give
            // their program back" — and if it would not, the conversion does not
            // get to become the program. See `lib/blocks/round-trip.ts`.
            const faithful = await verifyConversion(code, workspace)
            if (seq !== gateSeq.current) return
            if (!faithful.ok) {
              // Their text is untouched — `codeDraft` still holds exactly what
              // they typed, and nothing has been written. The blocks on screen
              // stay the blocks they already had.
              setHeldBack(faithful.reason)
              return
            }
            setHeldBack(null)
            updateBlocks(file.id, code, workspace)
            setReloadNonce((n) => n + 1)
          })
          .catch(() => {
            // The gate itself failing is not a reason to write something we
            // could not check.
            if (seq === gateSeq.current) setHeldBack('unloadable')
          })
      }, CODE_TO_BLOCKS_MS)
    },
    [file, updateBlocks]
  )

  // The part- and plugin-contributed palette (#1017). Registered here rather
  // than in the canvas because the canvas is lazily loaded and re-mounts on a
  // view-mode change, and re-running a Python host round-trip for a layout
  // change would be absurd.
  const { nonce: paletteNonce, partFor } = useDynamicBlocks(currentFolder)
  // The parts whose blocks are on the canvas right now — the driver banner's
  // input. Empty until the canvas reports, which is also the state on a file
  // with no part blocks in it, so the banner simply never appears.
  const [partsUsed, setPartsUsed] = useState<readonly { libraryId: string; partId: string }[]>([])
  useEffect(() => setPartsUsed([]), [file?.id])
  /**
   * USING a part's block offers its driver (#1017) — the same consent-first
   * banner the Board View shows when the part is placed, in the workspace that
   * hides the Board View.
   *
   * It is the right moment for it. Placing a part on the breadboard is a drawing
   * action and its driver may never be needed; dragging that part's BLOCK into a
   * program is a statement of intent to run code that imports it, and the import
   * is the line that will fail.
   */
  const driverNeeds = useMemo<PartDriverNeed[]>(() => {
    const out: PartDriverNeed[] = []
    for (const ref of partsUsed) {
      const part = partFor(ref.libraryId, ref.partId)
      if (!part?.drivers || part.drivers.length === 0) continue
      out.push({
        key: `${ref.libraryId}:${ref.partId}`,
        libraryId: ref.libraryId,
        partId: ref.partId,
        label: part.name || ref.partId,
        part,
        drivers: part.drivers
      })
    }
    return out
  }, [partsUsed, partFor])

  if (!file || !doc) {
    return (
      <div className="blocks-split blocks-split--empty">
        <p className="blocks-split__note">No file is open.</p>
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
        onHoverBlock={setLinkedBlock}
        onSelectBlock={setLinkedBlock}
        selectBlockId={selectFromPython}
        selectNonce={selectNonce}
        onShowBlockPython={setPythonFor}
        paletteNonce={paletteNonce}
        onPartsUsed={setPartsUsed}
        reloadNonce={reloadNonce}
      />
    </Suspense>
  )
  // The generator's output when there is any, the file's stored code until then
  // — so the pane is never blank for the frame between opening and generating.
  // The learner's own text while they are typing it, the generator's output
  // otherwise. See `codeDraft` above for why the order matters.
  const shown = codeDraft ?? generated?.code ?? doc.code
  const python = (
    <Suspense fallback={<div className="blocks-split__loading">Loading the Python…</div>}>
      <PythonPane
        code={shown}
        onCodeChange={handleCodeChange}
        highlightLines={linkedLines}
        onLineClick={handleLineClick}
        revealLine={revealLine}
      />
    </Suspense>
  )

  return (
    <div className="blocks-split" ref={hostRef}>
      {driverNeeds.length > 0 && <DriverInstallBanner needs={driverNeeds} />}
      {/* THE ROUND-TRIP GATE SAID NO (#1068).
          Said quietly, and said at all — the canvas is showing blocks from
          before their last edit, and a learner who is not told that is a
          learner watching the blocks ignore them. Not an error: their Python is
          exactly as they typed it and still runs. */}
      {heldBack && (
        <p className="blocks-split__held" role="status">
          <span className="blocks-split__held-mark" aria-hidden="true" />
          These blocks are from before your last edit — Snakie could not turn that
          Python into blocks without changing it. Your code is fine and will still
          run.
        </p>
      )}
      {/* "What did THIS block write?" — right-click ▸ Show me the Python. */}
      {pythonFor && generated && (
        <BlockPythonPopover
          code={generated.code}
          lines={generated.blockLines.get(pythonFor) ?? []}
          onClose={() => setPythonFor(null)}
        />
      )}

      {/* THE MIDDLE STOP, marked. The two ends announce themselves — you can
          see the pane you are about to close — but nothing says the divider
          rests halfway, so a learner who drags it once goes all the way across
          and never finds the view the whole epic is built around. One dot,
          beneath and between the two panes, on the stop it marks. */}
      {view.kind === 'split' && (
        <span
          className={`blocks-split__detent${Math.abs(canvasShare - 50) < 6 ? ' is-near' : ''}`}
          aria-hidden="true"
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
          onLayout={(sizes) => {
            ratioRef.current = [sizes[0] ?? 50, sizes[1] ?? 50]
            setCanvasShare(sizes[0] ?? 50)
            layout.recordSizes('blocksSplit', sizes)
          }}
        >
          {/* `minSize={0}`, so an end stop CLOSES its pane rather than leaving a
              sliver of it bleeding in at the edge. This used to be three
              percent — forty pixels of chopped-off Python beside the blocks —
              because the divider was the only way back and a divider flush
              against the edge of the group cannot be grabbed. #1053's dot is
              that way back now, from either end and by name, so the strip is no
              longer paying for itself. The panel is still not `collapsible`:
              the library's collapse is a separate state its imperative API
              owns, and the ratio is ours. */}
          <Panel order={1} minSize={0} defaultSize={view.ratio[0]}>
            {canvas}
          </Panel>
          {/* THE DIVIDER IS THE CONTROL (#1034). Three buttons reading
              `Blocks · Split · Python` looked like three modes; there is one
              axis with an in-between, and the thing that moves along it is the
              thing you already reach for to resize. */}
          <PanelResizeHandle
            className="resize-handle resize-handle--vertical blocks-split__divider"
            onDragging={(isDragging) => {
              if (isDragging) return
              // Snap on RELEASE, never during the drag: a divider that jumps
              // out from under the pointer is a divider you cannot aim.
              const stop = stopFor(ratioRef.current[0])
              if (!stop) {
                onModeChange(modeForRatio(ratioRef.current))
                return
              }
              groupRef.current?.setLayout([stop.at, 100 - stop.at])
              onModeChange(stop.mode)
            }}
          />
          <Panel order={2} minSize={0} defaultSize={view.ratio[1]}>
            {python}
          </Panel>
        </PanelGroup>
      )}
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

export default BlocksSplit
