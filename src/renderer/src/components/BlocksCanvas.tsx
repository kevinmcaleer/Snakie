import { useCallback, useEffect, useMemo, useRef } from 'react'
import * as Blockly from 'blockly/core'
import { usePrompt } from './PromptModal'
import {
  buildSoftShellTheme,
  readThemeTokens,
  softShellWorkspaceOptions,
  type BlocklyThemeInput
} from '../lib/blocks/theme'
import { generateProgram, type GeneratedProgram } from '../lib/blocks/generator'
import { ledPinToken, setBoardPins } from '../lib/blocks/board-pins'
import { applyPinWarnings } from '../lib/blocks/pin-conflicts'
import { refreshPinFields } from '../lib/blocks/pin-field'
import { applyPythonWarnings } from '../lib/blocks/python-warnings'
// Installs the Monaco editor the escape-hatch fields open (#1018). Imported for
// the side effect, and HERE rather than in the palette: the palette is built in
// plain node by the generator's golden-file suites, and Monaco touches `window`
// the moment it is imported.
import '../lib/blocks/python-editor'
import { loadSelectedBoard, watchSelectedBoard } from './board-pin-source'
import { blockDefinition, installBlockDefinitions } from '../lib/blocks/registry'
import { installCorePalette } from '../lib/blocks/palette'
import { installSoftShellRenderer } from '../lib/blocks/renderer'
import {
  dispatchNeedLibrary,
  dispatchOpenHelp,
  dispatchRevealInstruments,
  PROGRAM_RUN_EVENT,
  type ProgramRunDetail
} from './editorBridge'
import {
  blockForLine,
  friendlyError,
  isRealError,
  TracebackWatcher
} from '../lib/blocks/traceback'
import { ensureBlocklyLocale } from '../lib/blocks/locale'
import { unknownBlockTypes } from '../lib/blocks/workspace-check'
import { buildToolbox } from '../lib/blocks/toolbox'
import { installVariablesDrawer } from '../lib/blocks/variables-drawer'
import { installDuplicateShortcut } from '../lib/blocks/duplicate'
import type { Dialect } from '../../../shared/dialect'
import { useHelpDialect } from '../hooks/useHelpDialect'
import { isStaleDeselect, putOutHighlight } from '../lib/blocks/highlight'
import type { BlocksWorkspace } from '../../../shared/blocks-doc'
import './BlocksCanvas.css'

/**
 * THE BLOCK CANVAS (#1009, epic #1007).
 * =============================================================================
 *
 * Blockly, injected into a resize-observed host, wearing Soft Shell, bound to
 * the active file's workspace JSON.
 *
 * WHY BLOCKLY AND NOT SOMETHING OF OUR OWN. It is Apache-2.0, it is what Scratch
 * itself is built on — so the muscle memory a child arrives with transfers on
 * day one — and in v13 keyboard navigation and screen-reader support are in
 * core rather than a plugin, which is not something we would rebuild to the same
 * standard for a tool aimed at schools (epic #188).
 *
 * WHAT THIS COMPONENT OWNS. Injection, theming, resize, serialisation in and
 * out, the `window.prompt` bridge, and — since #1010 — running the generator:
 * it holds the live workspace, so generating here costs one walk rather than a
 * second deserialisation somewhere else, and the source map comes out addressing
 * the block ids that are actually on screen.
 *
 * It does NOT own the toolbox CONTENTS. The categories come from the theme's one
 * list (so a category can never have a colour but no home) and their blocks from
 * the registry (`registry.ts`), which the palettes — #1011–#1014, #1017, #1018 —
 * fill without touching this file.
 *
 * THE UNCONTROLLED SEAM. Blockly owns the DOM and its own undo stack, so this
 * is deliberately NOT a controlled component. The file's JSON is loaded once per
 * document, and after that the canvas is the source of truth until the user
 * opens something else — `lastLoadedRef` is what stops an edit echoing back
 * through the store and re-loading the workspace under the user's cursor, which
 * resets the scroll position and eats the undo history.
 *
 * DISPLAY AND WRITE ARE DIFFERENT EVENTS, which is why there are two callbacks.
 * Opening a file has to SHOW its Python immediately, but must not write anything
 * — a file whose stored code came from an older generator would otherwise be
 * marked dirty for the crime of being opened, which is the bug #1009 already
 * had to fix once. So `onGenerate` fires whenever there is fresh code to look
 * at, and `onEdit` only when the learner actually changed something.
 */
/** A generated program, plus the workspace it came from — the pair a caller
 *  needs to write the file, since `blocks-doc.ts` only ever takes both. */
export interface BlocksProgram extends GeneratedProgram {
  workspace: BlocksWorkspace
}

/** How long the canvas waits after the last change before regenerating (ms).
 *  Short enough that the mirror feels live while you drag; long enough that one
 *  gesture is one regeneration. */
const REGENERATE_DEBOUNCE_MS = 120

export interface BlocksCanvasProps {
  /** Identity of the document on screen — a change here means "load this". */
  fileId: string
  /** The file's serialised workspace. */
  workspace: BlocksWorkspace
  /** Fresh code to LOOK at — after a load, and after every edit. Never a write. */
  onGenerate?: (program: BlocksProgram) => void
  /** The learner changed something: write this code and workspace to the file. */
  onEdit: (program: BlocksProgram) => void
  /** Collapsed to a peek strip by the `Python` view mode — skip the injection. */
  peek?: boolean
  /** Click handler for the peek strip (restores the split). */
  onExpand?: () => void
  /**
   * The learner is pointing at a block (#1016) — hovered, or `null` on leaving.
   *
   * The whole pedagogical payload of the epic hangs off this: the mirror lights
   * up the lines this block wrote, so "these blocks" and "this Python" stop
   * being two things on one screen and start being the same thing twice.
   */
  onHoverBlock?: (blockId: string | null) => void
  /** The learner clicked a block, or cleared the selection. */
  onSelectBlock?: (blockId: string | null) => void
  /**
   * Select and centre this block — the other direction, driven by a click in the
   * Python.
   *
   * `null` CLEARS the highlight (#1050). It used to leave the canvas alone, on
   * the reasoning that moving the mouse out of the pane should not deselect what
   * the learner had just found — but hovering drives `onHoverBlock`, not this,
   * so the only thing that ever sends `null` is a click on a line no block
   * wrote. That is a real answer and deserves to look like one, and leaving the
   * last block lit instead made the link look stuck.
   */
  selectBlockId?: string | null
  /**
   * Bumped on every line click, so the SAME block can be asked for twice
   * (#1050).
   *
   * Clicking into the code pane moves focus out of the canvas, which is how
   * Blockly clears a selection — so "the same block as last time" still needs
   * re-asserting, and an id alone cannot say that.
   */
  selectNonce?: number
  /** Right-click ▸ "Show me the Python for just this block". */
  onShowBlockPython?: (blockId: string) => void
  /**
   * Bumped when the part/plugin palette changes (#1017) — the toolbox is rebuilt
   * on it.
   *
   * A NONCE rather than the blocks themselves, because the canvas does not own
   * them: they are in the module registry by the time this changes, and passing
   * them through props would mean two copies that could disagree about which
   * blocks exist.
   */
  paletteNonce?: number
  /**
   * Which parts the blocks on the canvas belong to (#1017), deduplicated — so
   * the caller can offer to install their drivers.
   */
  onPartsUsed?: (parts: readonly { libraryId: string; partId: string }[]) => void
  /**
   * Bumped when the workspace changed from OUTSIDE the canvas (#1034) — the
   * learner edited the code, and it was converted back into blocks.
   *
   * The canvas is otherwise the source of truth once it is up (see the load
   * effect), which is what stops an edit echoing back and re-loading under the
   * user's cursor. A code edit is the one case where the outside is ahead, and
   * this is how it says so.
   */
  reloadNonce?: number
}

// Blockly's message table is a precondition of `inject` — see `locale.ts`.
ensureBlocklyLocale()
// The core palette (#1011) registers at module load, before any canvas exists,
// which is what lets the toolbox below be built from the registry.
installCorePalette()
// And its definitions go into Blockly IMMEDIATELY, not at inject time. The
// `blocked` check below asks Blockly whether it knows each block type in the
// file, and it runs during render — before any effect. Installing only at
// inject made every palette block look like a block from a newer Snakie, so a
// perfectly good file met the "these blocks need a newer Snakie" notice and the
// canvas never mounted at all. The inject-time call stays for blocks a part or
// plugin registers later (#1017).
installBlockDefinitions()
installBlockHelpMenu()

/**
 * The warning "channel" a runtime error uses (#1015).
 *
 * Blockly keys warnings by id, so an error and #1012's pin-conflict warning can
 * sit on the same block without either erasing the other — which matters,
 * because a block on a pin it can't use is exactly the block likely to raise.
 */
const ERROR_WARNING = 'snakie-error'

export function BlocksCanvas({
  fileId,
  workspace,
  onGenerate,
  onEdit,
  peek = false,
  onExpand,
  onHoverBlock,
  onSelectBlock,
  selectBlockId,
  selectNonce = 0,
  onShowBlockPython,
  paletteNonce = 0,
  onPartsUsed,
  reloadNonce = 0
}: BlocksCanvasProps): JSX.Element {
  // BEFORE anything else: can this build read these blocks at all? A file made
  // by a newer Snakie, or with a part/plugin's blocks (#1017) that isn't
  // installed here, carries types Blockly will refuse. If we injected anyway,
  // the deserialiser would throw, the canvas would clear, and the next change
  // event would serialise that empty workspace back over the file — deleting
  // the program while claiming to display it. So the canvas does not mount at
  // all, which means there is no path from this screen to that file.
  const unknown = useMemo(
    () =>
      unknownBlockTypes(workspace, (t) => Object.prototype.hasOwnProperty.call(Blockly.Blocks, t)),
    [workspace]
  )
  const blocked = unknown.length > 0
  const hostRef = useRef<HTMLDivElement>(null)
  const wsRef = useRef<Blockly.WorkspaceSvg | null>(null)
  /** The JSON we last pushed INTO Blockly, so our own echo is recognisable. */
  const lastLoadedRef = useRef<string>('')
  /** Suppresses `onChange` while `Blockly.serialization.workspaces.load` runs. */
  const loadingRef = useRef(false)
  /** A load that failed anyway — never write this canvas back to the file. */
  const writeBlockedRef = useRef(false)
  /**
   * The file the last load was for (#1036).
   *
   * A reload of the SAME file — the learner typed in the code pane — should put
   * the canvas back exactly as they left it. A load of a DIFFERENT file must
   * not: block ids are positional now, so `r0.0` means "the first statement" in
   * both programs, and carrying one file's layout into another would move the
   * new file's blocks to wherever the old file's happened to sit.
   */
  const loadedFileRef = useRef<string | null>(null)
  const onGenerateRef = useRef(onGenerate)
  onGenerateRef.current = onGenerate
  const onEditRef = useRef(onEdit)
  onEditRef.current = onEdit
  // The linking callbacks (#1016), through refs for the same reason as the rest:
  // they are read inside Blockly listeners registered once, and a stale closure
  // there would report a block to a mirror that has since moved on.
  const onHoverBlockRef = useRef(onHoverBlock)
  onHoverBlockRef.current = onHoverBlock
  const onSelectBlockRef = useRef(onSelectBlock)
  onSelectBlockRef.current = onSelectBlock
  /**
   * The block WE lit from a Python line click (#1016), so it can be put out
   * again — see {@link putOutHighlight}.
   */
  const litRef = useRef<string | null>(null)
  const onShowBlockPythonRef = useRef(onShowBlockPython)
  onShowBlockPythonRef.current = onShowBlockPython
  const onPartsUsedRef = useRef(onPartsUsed)
  onPartsUsedRef.current = onPartsUsed
  /** Pending regeneration, so a drag doesn't generate once per mouse move. */
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  /**
   * The source map of the code as it stands (#1015).
   *
   * A REF, not state: the traceback watcher reads it from inside a serial-stream
   * callback registered once, and a stale closure there would map a line number
   * against the program as it was three edits ago — pointing the error at the
   * wrong block, which is worse than pointing at none.
   */
  const sourceMapRef = useRef<ReadonlyMap<number, string>>(new Map())
  /** Blocks currently wearing an error badge, so a new run can clear exactly those. */
  const erroredRef = useRef<string[]>([])

  /**
   * WHICH PYTHON THIS BOARD SPEAKS (#1039, epic #209).
   *
   * The toolbox is filtered by it; the REGISTRY never is. See `scope` on
   * `BlockDefinition` — a hardware program written on a Pico has to keep
   * opening after a CircuitPython board is plugged in, and it only does
   * because every block stays defined whether or not it is reachable.
   */
  const { dialect } = useHelpDialect()
  /**
   * A REF as well, because the injection below must read the dialect WITHOUT
   * depending on it: re-injecting on a dialect change would tear the workspace
   * down and take the learner's program with it. The rebuild effect further
   * down is the one that follows the dialect.
   */
  const dialectRef = useRef(dialect)
  dialectRef.current = dialect
  /** The dialect the toolbox ON SCREEN was built for, so it isn't rebuilt twice. */
  const toolboxDialectRef = useRef<Dialect | null>(null)

  const prompt = usePrompt()

  // Blockly's variable-rename and text prompts call `window.prompt`, which
  // Electron's renderer does not implement — it returns null and does nothing,
  // so renaming a variable would silently fail with no clue why. Route them
  // through the in-app modal instead. `dialog.setPrompt` is global to Blockly,
  // hence the effect rather than an option.
  useEffect(() => {
    Blockly.dialog.setPrompt((message, defaultValue, callback) => {
      void prompt(message, defaultValue).then(callback)
    })
    return () => Blockly.dialog.setPrompt(undefined)
  }, [prompt])

  // Inject once. The theme is applied separately below so a skin change never
  // has to tear the workspace down.
  useEffect(() => {
    const host = hostRef.current
    if (!host || peek || blocked) return

    // Blockly has to know the registered blocks' shapes before a workspace can
    // hold one. Here rather than at module load, so a block a part or plugin
    // registers later (#1017) is installed by the next canvas that opens.
    installBlockDefinitions()
    // And the Soft Shell geometry, which the options below name. Registering a
    // renderer Blockly has never heard of throws during injection.
    installSoftShellRenderer()

    const tokens = readThemeTokens(document.documentElement)
    const ws = Blockly.inject(host, {
      ...softShellWorkspaceOptions(tokens),
      toolbox: buildToolbox(dialectRef.current),
      theme: Blockly.Theme.defineTheme(
        'snakie-soft-shell',
        buildSoftShellTheme(tokens) as BlocklyThemeInput
      )
    })
    wsRef.current = ws
    toolboxDialectRef.current = dialectRef.current

    // THE FUNCTIONS DRAWER IS DYNAMIC (#1045). Every other category is a fixed
    // list from the registry, which is right for them and wrong for this one:
    // its contents depend on what the learner has defined. Blockly's own
    // `flyoutCategory` reads the workspace and returns the two `def` blocks,
    // `ifreturn`, and ONE CALLER PER FUNCTION, already carrying that function's
    // name and parameter sockets. Without this the drawer held two blank,
    // nameless caller blocks and a learner who had just written their first
    // function had no way to call it.
    ws.registerToolboxCategoryCallback(
      Blockly.PROCEDURE_CATEGORY_NAME,
      Blockly.Procedures.flyoutCategory
    )

    // AND THE VARIABLES DRAWER, for the same reason one category along (#1117):
    // a learner's own variables are a question about the workspace, and a static
    // shelf could only offer one nameless `set _ to _` with the rest hidden in a
    // dropdown. The drawer also carries the Create variable button, whose prompt
    // reaches the in-app modal through the `dialog.setPrompt` bridge above —
    // without it the button would open nothing at all in Electron.
    //
    // The dialect comes from the REF, not the value: this effect must not
    // re-run on a runtime change, and the callback is asked afresh every time
    // the drawer opens, so it reads the current one anyway.
    installVariablesDrawer(ws, () => dialectRef.current)

    // ⌘D / Ctrl+D duplicates the selected block (#1117). Blockly's registry is
    // global rather than per workspace, hence a call that is safe to repeat.
    installDuplicateShortcut()

    const listener = (event: Blockly.Events.Abstract): void => {
      // UI-only events (scroll, select, a flyout opening) are not edits, and
      // treating them as edits would mark a file dirty for looking at it.
      if (event.isUiEvent || loadingRef.current || writeBlockedRef.current) return
      const json = Blockly.serialization.workspaces.save(ws) as BlocksWorkspace
      const serialised = JSON.stringify(json)
      // THE GUARD THAT ACTUALLY HOLDS. Blockly queues its events and fires them
      // on a later tick, so `loadingRef` — which is only true for the duration
      // of the synchronous `load` call — is already false when the load's own
      // events arrive. Without this, merely OPENING a blocks file marked it
      // dirty, put an unsaved dot on the tab and armed the close prompt, for a
      // file the user had done nothing to. Comparing against what we last put
      // in is the one test that can't be fooled by when an event shows up.
      if (serialised === lastLoadedRef.current) return
      lastLoadedRef.current = serialised
      // A block that belongs to an instrument reveals it (#1013). AFTER the guard
      // above, so this fires for a block a learner DRAGGED and not for the ones a
      // file arrived carrying — opening a turtle program should not force a dock
      // somebody deliberately closed back open, but reaching for a turtle block
      // should, because that is the moment they need somewhere to draw.
      revealInstrumentFor(ws, event)
      // Debounced: Blockly fires an event per drag frame, and generating (and
      // writing) forty times while a block is in the air would churn the mirror,
      // the source map and the undo-relevant buffer for one gesture.
      if (debounceRef.current) clearTimeout(debounceRef.current)
      debounceRef.current = setTimeout(() => {
        const program = { ...generateProgram(ws, dialectRef.current), workspace: json }
        // Keep the traceback mapper on the CURRENT program (#1015).
        sourceMapRef.current = program.sourceMap
        // Two blocks on one pin, a pin this board hasn't got, a pin that can't
        // do the job (#1012). The canvas is the only place that sees the whole
        // program at once, so it is where this is caught.
        applyPinWarnings(ws)
        // And the raw-Python blocks' own typos (#1018) — on the block that has
        // one, before Run, rather than as a device traceback naming a line in a
        // file the learner never wrote.
        applyPythonWarnings(ws)
        // Which parts this program now uses (#1017) — the caller offers their
        // drivers. Reported from the debounce rather than per create event so a
        // drag across the canvas is one answer, not forty.
        onPartsUsedRef.current?.(partsUsedBy(ws))
        onGenerateRef.current?.(program)
        onEditRef.current(program)
      }, REGENERATE_DEBOUNCE_MS)
    }
    ws.addChangeListener(listener)

    // WHICH BLOCK IS THE LEARNER POINTING AT (#1016).
    //
    // Selection comes through Blockly's own event, which fires for a click, for
    // keyboard navigation and for a programmatic `select()` alike — so the
    // mirror lights up however they got there, including with a keyboard
    // (epic #188).
    const pointing = (event: Blockly.Events.Abstract): void => {
      if (event.type !== Blockly.Events.SELECTED) return
      const selected = (event as Blockly.Events.Selected).newElementId ?? null
      // Our own `unselect()` below fires one of these carrying NO id, and
      // Blockly queues its events — so it can arrive AFTER we have lit the next
      // block, and forwarding it as the learner's choice puts the link out
      // (#1050). Ask what is selected now rather than guessing at the order.
      if (isStaleDeselect(selected, Blockly.getSelected()?.id ?? null)) return
      // The learner selected ANOTHER BLOCK themselves, so the one we lit from a
      // line click is stale (#1050). Blockly's own selection does not clear a
      // programmatic one, so clicking a block on the canvas used to leave two
      // lit at once.
      //
      // Only for a real block, never for a null selection — and that `null` is
      // not hypothetical. Our own `unselect()` of the previous block fires this
      // event with no id, and it arrives AFTER the effect has lit the new one;
      // treating that as "they selected nothing" put the fresh highlight out
      // again the instant it appeared. Clicking away on the canvas deselects
      // through Blockly's own path anyway, so nothing is missed by ignoring it.
      if (selected) putOutHighlight(wsRef.current, litRef, selected)
      onSelectBlockRef.current?.(selected)
    }
    ws.addChangeListener(pointing)

    // HOVER is not a Blockly event, so it comes off the DOM. One delegated
    // listener on the host rather than one per block: blocks are created and
    // destroyed constantly, and per-block listeners would leak with every drag.
    const blockUnder = (target: EventTarget | null): string | null => {
      const el = target instanceof Element ? target.closest('.blocklyDraggable') : null
      const id = el?.getAttribute('data-id')
      // A block inside the FLYOUT is a menu item, not part of the program, and
      // has no line in the generated code to light up.
      if (!id || el?.closest('.blocklyFlyout')) return null
      return id
    }
    let hovered: string | null = null
    const onMove = (e: MouseEvent): void => {
      const id = blockUnder(e.target)
      if (id === hovered) return
      hovered = id
      onHoverBlockRef.current?.(id)
    }
    const onLeave = (): void => {
      if (hovered === null) return
      hovered = null
      onHoverBlockRef.current?.(null)
    }
    host.addEventListener('mousemove', onMove)
    host.addEventListener('mouseleave', onLeave)

    return () => {
      host.removeEventListener('mousemove', onMove)
      host.removeEventListener('mouseleave', onLeave)
      ws.removeChangeListener(pointing)
      if (debounceRef.current) clearTimeout(debounceRef.current)
      ws.removeChangeListener(listener)
      ws.dispose()
      wsRef.current = null
      lastLoadedRef.current = ''
    }
  }, [peek, blocked])

  // The pin dropdowns offer THIS board's pins (#1012). Loaded here rather than
  // by the blocks themselves because a Blockly field's option list is produced
  // inside Blockly's own event handling, with no React anywhere near it — so the
  // canvas pushes and `board-pins.ts` holds.
  useEffect(() => {
    const apply = (): void => {
      void loadSelectedBoard().then((board) => {
        const swapped = setBoardPins(
          board.pins.map((p) => ({ gpio: p.gpio, label: p.label, capabilities: p.capabilities })),
          ledPinToken(board.ledLabel)
        )
        // The warnings on screen were computed against the OLD board's pins, so
        // a board swap has to re-run them or a stale "this board has no GP22"
        // outlives the board that didn't.
        const ws = wsRef.current
        if (!ws) return
        // And so do the LABELS. A board that calls GP0 `D1` renames what every
        // pin dropdown in the program is showing, and a field works its label
        // out while Blockly draws the block — so without this the old board's
        // names sit on the canvas until something else happens to redraw them.
        if (swapped) refreshPinFields(ws)
        applyPinWarnings(ws)
      })
    }
    apply()
    return watchSelectedBoard(apply)
  }, [])

  // Tracebacks land on the block that caused them (#1015).
  //
  // Reading the SAME broadcast serial stream the Terminal and the instruments
  // read — nothing is intercepted and nothing is hidden: the console prints the
  // board's own traceback verbatim, because that text is what a learner is
  // graduating to. What lands on the block is one sentence beside it.
  useEffect(() => {
    if (peek || blocked) return
    const watcher = new TracebackWatcher()
    const decoder = new TextDecoder()
    // Captured now: the cleanup below takes the glow off, and by then the ref
    // may point at a different node (or none), which would leave a canvas
    // glowing for a program that ended.
    const host = hostRef.current

    /** Take the error badges off, which is what a new run and Stop both do. */
    const clearErrors = (): void => {
      const ws = wsRef.current
      for (const id of erroredRef.current) ws?.getBlockById(id)?.setWarningText(null, ERROR_WARNING)
      erroredRef.current = []
    }

    const offData = window.api.device.onData((chunk) => {
      const parsed = watcher.feed(decoder.decode(chunk, { stream: true }))
      // Stop raises KeyboardInterrupt wherever the program had got to; badging
      // whichever block that was would tell a child they broke something when
      // all they did was press Stop.
      if (!parsed || !isRealError(parsed)) return
      // The program is over: MicroPython prints the traceback and hands the
      // prompt back. The glow says "alive", so it has to stop saying it — a
      // canvas still pulsing over a crashed program is a lie about the one
      // thing it exists to report.
      host?.classList.remove('blocks-canvas__host--running')
      const friendly = friendlyError(parsed)
      // The install banner, back on its feet: `ImportError: no module named
      // 'instruments'` is not a sentence a child can act on, and the fix is one
      // button they may have dismissed on connect.
      if (friendly?.install) dispatchNeedLibrary(friendly.install)

      const ws = wsRef.current
      const id = blockForLine(sourceMapRef.current, parsed.line)
      const block = id ? ws?.getBlockById(id) : null
      // An error with nowhere to land is not a failure of this feature: an
      // import line belongs to no block, and a library-only traceback has no
      // frame in the learner's program at all. The console still has it.
      if (!block) return
      clearErrors()
      block.setWarningText(
        friendly ? `${friendly.text}\n\n${parsed.error}: ${parsed.message}` : `${parsed.error}: ${parsed.message}`,
        ERROR_WARNING
      )
      erroredRef.current = [block.id]
      ws?.centerOnBlock(block.id)
    })

    const onRunState = (e: Event): void => {
      const running = (e as CustomEvent<ProgramRunDetail>).detail?.running === true
      // A new run starts from a clean canvas, or a program the learner has just
      // fixed still wears the last run's badge and looks broken.
      watcher.reset()
      clearErrors()
      host?.classList.toggle('blocks-canvas__host--running', running)
    }
    window.addEventListener(PROGRAM_RUN_EVENT, onRunState)

    return () => {
      offData()
      window.removeEventListener(PROGRAM_RUN_EVENT, onRunState)
      host?.classList.remove('blocks-canvas__host--running')
    }
  }, [peek, blocked])

  // The context-menu item is registered once for the app; the canvas that can
  // answer it is mounted per file. Claim the slot while we are on screen.
  useEffect(() => {
    if (peek || blocked) return
    showBlockPython = (blockId: string) => onShowBlockPythonRef.current?.(blockId)
    return () => {
      showBlockPython = null
    }
  }, [peek, blocked])

  // A line was clicked in the Python (#1016): select its block and bring it into
  // view. The other half of the link, and the half that does the teaching —
  // "that line came from THIS", pointed at from the side they are learning to
  // read.
  //
  // CLEARING IS NOT AUTOMATIC, and assuming it was is what made the link feel
  // broken (#1050). `BlockSvg.select()` highlights, but in Blockly 13 the
  // CURRENT selection belongs to the focus manager — `common.setSelected` is
  // `@internal` and its own doc says a selection is cleared by focusing
  // something else, which a programmatic `select()` never does. So calling it
  // on block after block ADDED a highlight each time and removed none: clicking
  // four lines in turn left four blocks lit, and the learner had to click each
  // one on the canvas and away again to put it out.
  //
  // So this effect clears before it selects, every time — including when there
  // is nothing to select, which is the case that matters most. An import, a
  // blank line, a comment: pointing at a line no block wrote is a real answer
  // ("nothing here came from a block"), and it has to look like one.
  useEffect(() => {
    if (peek || blocked) return
    const ws = wsRef.current
    if (!ws) return

    putOutHighlight(ws, litRef, selectBlockId ?? null)
    // And whatever Blockly itself has, so a block the learner selected by
    // clicking the canvas does not stay lit beside the one they just asked for.
    const current = Blockly.getSelected()
    if (current && current.id !== selectBlockId && current instanceof Blockly.BlockSvg) {
      current.unselect()
    }

    if (!selectBlockId) return
    const block = ws.getBlockById(selectBlockId)
    if (!block) return
    // Centring rather than merely selecting: a block off-screen is selected and
    // invisible, which looks exactly like nothing happening.
    ws.centerOnBlock(selectBlockId)
    block.select()
    litRef.current = selectBlockId
  }, [selectBlockId, selectNonce, peek, blocked])

  // Follow the app's skin. Same MutationObserver pattern as `Terminal.tsx` and
  // `RobotView.tsx`: `data-theme` on the document root is the single source of
  // truth for which skin is showing.
  useEffect(() => {
    if (peek || blocked) return
    const apply = (): void => {
      const ws = wsRef.current
      if (!ws) return
      const tokens = readThemeTokens(document.documentElement)
      ws.setTheme(
        Blockly.Theme.defineTheme(
          'snakie-soft-shell',
          buildSoftShellTheme(tokens) as BlocklyThemeInput
        )
      )
    }
    const observer = new MutationObserver(apply)
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme']
    })
    return () => observer.disconnect()
  }, [peek, blocked])

  // THE PALETTE FOLLOWS THE BREADBOARD (#1017) AND THE BOARD'S RUNTIME (#1039).
  //
  // A part dropped in Electronics registers its blocks, bumps the nonce, and
  // this puts them in the toolbox of a canvas that is already open — no reload,
  // no re-inject, and the learner's program untouched underneath. Plugging in a
  // CircuitPython board arrives the same way: `useHelpDialect` is live, so the
  // drawers re-filter the moment the runtime probe answers.
  //
  // `installBlockDefinitions` FIRST: `updateToolbox` builds a flyout block of
  // every type it is given, and a type Blockly has not been taught throws while
  // the flyout opens, which would take the whole toolbox down with it.
  useEffect(() => {
    const ws = wsRef.current
    if (!ws || peek || blocked) return
    // Nonce 0 with the dialect unchanged is the first pass, whose toolbox the
    // injection above already built.
    if (paletteNonce === 0 && toolboxDialectRef.current === dialect) return
    try {
      installBlockDefinitions()
      ws.updateToolbox(buildToolbox(dialect))
      toolboxDialectRef.current = dialect
    } catch (err) {
      console.warn('[blocks] could not rebuild the toolbox', err)
    }
  }, [paletteNonce, dialect, peek, blocked])

  // Load the document. Keyed on the FILE — and on `reloadNonce`, which is the
  // one case where the outside is ahead of the canvas (#1034: the learner typed
  // in the code pane and it was converted back). Keying on the JSON instead
  // would re-load on every workspace change and fight the user's own drag,
  // because the store's content is otherwise downstream of this canvas.
  useEffect(() => {
    const ws = wsRef.current
    if (!ws || peek || blocked) return
    // A reload rebuilds every block, so the view would jump back to the origin
    // each time the learner paused typing. Put it back where they left it.
    const scroll =
      'scrollX' in ws ? { x: (ws as Blockly.WorkspaceSvg).scrollX, y: (ws as Blockly.WorkspaceSvg).scrollY } : null
    // WHERE THE LEARNER PUT THINGS (#1036). A reload rebuilds every block from
    // the document, whose roots are laid out on a grid — so a root somebody
    // dragged aside goes back to the grid, once per typing pause. Ids are
    // positional (`python-to-blocks.ts`), so a root that is still the same
    // statement is still the same id, and putting it back is a lookup.
    const sameFile = loadedFileRef.current === fileId
    const places = new Map<string, { x: number; y: number }>()
    const selected = sameFile ? (Blockly.getSelected()?.id ?? null) : null
    if (sameFile) {
      for (const block of ws.getTopBlocks(false)) {
        const at = block.getRelativeToSurfaceXY()
        places.set(block.id, { x: at.x, y: at.y })
      }
    }
    loadedFileRef.current = fileId
    writeBlockedRef.current = false
    loadingRef.current = true
    // Belt to the comparison's braces: Blockly's own way of saying "this change
    // is mine, not the user's". It also keeps the load off the undo stack, so a
    // first ⌘Z undoes the user's first action rather than the file opening.
    Blockly.Events.disable()
    try {
      Blockly.serialization.workspaces.load(workspace, ws)
      // What comes BACK OUT, not what went in: Blockly normalises as it loads
      // (fills in default fields, assigns ids, rounds coordinates), so a
      // re-serialise of an untouched workspace differs from the file's own
      // bytes. Recording the normalised form is what makes the listener's
      // "nothing actually changed" comparison mean anything.
      const loaded = Blockly.serialization.workspaces.save(ws) as BlocksWorkspace
      lastLoadedRef.current = JSON.stringify(loaded)
      // Show the Python at once — but through `onGenerate` only. Writing here
      // would dirty a file whose stored code merely predates this generator,
      // for the crime of being opened.
      const opened = { ...generateProgram(ws, dialectRef.current), workspace: loaded }
      sourceMapRef.current = opened.sourceMap
      onGenerateRef.current?.(opened)
      applyPinWarnings(ws)
      applyPythonWarnings(ws)
      // Show the instruments this program draws into (#1013). On LOAD as well as
      // on a drag, because a turtle program whose picture goes nowhere is a
      // program that looks like it did nothing — which is exactly what happens
      // when a child saves their square, opens it the next day and presses Run.
      // Once per load rather than per block: the load fires a create event per
      // block, and revealing eighteen times would scroll the dock eighteen times.
      dispatchRevealInstruments(instrumentsUsedBy(ws))
      // And the parts it needs drivers for (#1017) — on load too, because a
      // program saved yesterday is exactly the one whose board has been
      // re-flashed since.
      onPartsUsedRef.current?.(partsUsedBy(ws))
      // Back where they were. Only roots: everything else is positioned by the
      // block it is connected to, and moving those would be a fight with
      // Blockly's own layout rather than a courtesy.
      for (const block of ws.getTopBlocks(false)) {
        const at = places.get(block.id)
        if (!at) continue
        const now = block.getRelativeToSurfaceXY()
        block.moveBy(at.x - now.x, at.y - now.y)
      }
      // And still selected, so a reconversion cannot steal the highlight out
      // from under #1016's link.
      if (selected) {
        const block = ws.getBlockById(selected)
        if (block && 'select' in block) (block as Blockly.BlockSvg).select()
      }
      if (scroll && 'scroll' in ws) {
        try {
          ;(ws as Blockly.WorkspaceSvg).scroll(scroll.x, scroll.y)
        } catch {
          /* a workspace with no rendered view — nothing to put back */
        }
      }
    } catch {
      // Belt and braces behind the `blocked` check above: a type can be
      // registered and still fail to deserialise (a malformed field, a shape
      // from a newer schema). `writeBlockedRef` is the part that matters — it
      // stops the listener dead, so the cleared canvas can never be mistaken
      // for an edit and serialised back over the file.
      ws.clear()
      lastLoadedRef.current = ''
      writeBlockedRef.current = true
    } finally {
      Blockly.Events.enable()
      loadingRef.current = false
    }
    // `workspace` is intentionally not a dependency — see the comment above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileId, reloadNonce, peek, blocked])

  // Blockly sizes itself from its host and does not observe it, so a panel drag,
  // a workspace switch or a window resize leaves the canvas the wrong size with
  // its blocks unclickable where they no longer are.
  useEffect(() => {
    const host = hostRef.current
    if (!host || peek || blocked) return
    const observer = new ResizeObserver(() => {
      const ws = wsRef.current
      if (ws) Blockly.svgResize(ws)
    })
    observer.observe(host)
    return () => observer.disconnect()
  }, [peek, blocked])

  const expand = useCallback(() => onExpand?.(), [onExpand])

  if (blocked) {
    return <BlocksUnreadable types={unknown} />
  }

  if (peek) {
    return (
      <button type="button" className="blocks-peek" onClick={expand} title="Show the blocks">
        <span className="blocks-peek__label">Blocks</span>
      </button>
    )
  }

  return <div className="blocks-canvas__host" ref={hostRef} data-testid="blocks-canvas-host" />
}

/**
 * The file uses blocks this build doesn't have (#1009).
 *
 * Deliberately offers NO action. "Install what's missing" needs to know where a
 * block came from; "open it anyway" is the overwrite this whole path exists to
 * prevent. Doing nothing is a real option and is spelled out, because for a file
 * from a newer Snakie it is the right one — and the code is readable in the pane
 * beside this notice either way (#1034), which is where the escape now is.
 */
function BlocksUnreadable({ types }: { types: readonly string[] }): JSX.Element {
  return (
    <div className="blocks-unreadable" role="alert">
      <h2 className="blocks-unreadable__title">These blocks need a newer Snakie</h2>
      <p>
        This file uses {types.length === 1 ? 'a block' : 'blocks'} this version doesn&rsquo;t know
        about, so the canvas can&rsquo;t show {types.length === 1 ? 'it' : 'them'}:
      </p>
      <ul className="blocks-unreadable__types">
        {types.slice(0, 8).map((t) => (
          <li key={t}>
            <code>{t}</code>
          </li>
        ))}
        {types.length > 8 && <li>&hellip; and {types.length - 8} more</li>}
      </ul>
      <p className="blocks-unreadable__hint">
        Nothing has been changed, and closing this file leaves it exactly as it is — update Snakie,
        or install the part or plugin these blocks came from, and it will open normally.
      </p>
    </div>
  )
}

/**
 * A block's right-click **Help**, opening the in-app help article (#1011).
 *
 * Blockly's own Help item opens `helpUrl` in a browser, which for a child on a
 * school network — or on a Chromebook with no connection at all (epic #267) —
 * opens nothing. The help library is already in the app, already offline, and
 * already written for exactly these topics, so the menu item goes there instead.
 *
 * Registered once at module load. `preconditionFn` hides it for a block with no
 * article rather than showing an item that does nothing.
 */
function installBlockHelpMenu(): void {
  installBlockPythonMenu()
  const id = 'snakieBlockHelp'
  if (Blockly.ContextMenuRegistry.registry.getItem(id)) return
  // Blockly's OWN Help item comes first, and it opens `helpUrl` — which every
  // stock block has — in a browser. Left in place the menu offers two things
  // called "Help" that go to different places, one of which is a web page a
  // classroom may not be able to reach. There is one Help here, and it is ours.
  Blockly.ContextMenuRegistry.registry.unregister('blockHelp')
  Blockly.ContextMenuRegistry.registry.register({
    id,
    scopeType: Blockly.ContextMenuRegistry.ScopeType.BLOCK,
    weight: 100,
    displayText: 'Help',
    preconditionFn: (scope) =>
      scope.block && blockDefinition(scope.block.type)?.help ? 'enabled' : 'hidden',
    callback: (scope) => {
      const article = scope.block && blockDefinition(scope.block.type)?.help
      if (article) dispatchOpenHelp(article)
    }
  })
}

/**
 * A block's right-click **Show me the Python** (#1016).
 *
 * The mirror already shows the Python for the whole program, and the linked
 * highlighting already lights up a hovered block's lines in it. This is for the
 * question that asks itself the other way round — *"what did THIS one write?"* —
 * on a program long enough that the answer is somewhere off the top of the pane.
 *
 * Dispatched through a module-level handler rather than a prop, because a
 * Blockly context-menu item is registered once for the whole app while the
 * canvas that should answer it is mounted and unmounted with the file. The
 * canvas sets the handler on mount; an item clicked with none set does nothing
 * rather than throwing inside Blockly's menu.
 */
let showBlockPython: ((blockId: string) => void) | null = null

function installBlockPythonMenu(): void {
  const id = 'snakieBlockPython'
  if (Blockly.ContextMenuRegistry.registry.getItem(id)) return
  Blockly.ContextMenuRegistry.registry.register({
    id,
    scopeType: Blockly.ContextMenuRegistry.ScopeType.BLOCK,
    // Above Help: it is about the block in front of them, where Help is about
    // the kind of block.
    weight: 99,
    displayText: 'Show me the Python',
    preconditionFn: (scope) => (scope.block && showBlockPython ? 'enabled' : 'hidden'),
    callback: (scope) => {
      if (scope.block) showBlockPython?.(scope.block.id)
    }
  })
}

/**
 * The instruments a whole workspace's blocks declare, deduplicated (#1013).
 *
 * Registration order, so a program using two instruments reveals them in the
 * order its blocks were written rather than whatever order a Set iterates.
 */
function instrumentsUsedBy(ws: Blockly.Workspace): string[] {
  const seen = new Set<string>()
  for (const block of ws.getAllBlocks(false)) {
    const instrument = blockDefinition(block.type)?.instrument
    if (instrument) seen.add(instrument)
  }
  return [...seen]
}

/**
 * The parts whose blocks are on the canvas, deduplicated (#1017).
 *
 * Read off each block's REGISTERED DEFINITION rather than its type name: the
 * definition is where the part reference was declared, and parsing it back out
 * of a namespaced type string would be a second encoding of the same fact that
 * could disagree with the first.
 */
function partsUsedBy(ws: Blockly.Workspace): { libraryId: string; partId: string }[] {
  const seen = new Map<string, { libraryId: string; partId: string }>()
  for (const block of ws.getAllBlocks(false)) {
    const part = blockDefinition(block.type)?.part
    if (part) seen.set(`${part.libraryId}:${part.partId}`, part)
  }
  return [...seen.values()]
}

/**
 * Reveal the instrument a newly created block belongs to (#1013).
 *
 * Only on CREATE: a learner dragging a turtle block out of the flyout needs the
 * Turtle instrument on screen, but moving or editing one they already have does
 * not — re-revealing on every edit would fight anybody who closed the dock.
 *
 * The block's own definition names the instrument (`registry.ts`'s `instrument`),
 * so this reads a declared fact rather than guessing from the block's category
 * or its type name.
 */
function revealInstrumentFor(ws: Blockly.Workspace, event: Blockly.Events.Abstract): void {
  if (event.type !== Blockly.Events.BLOCK_CREATE) return
  const id = (event as Blockly.Events.BlockCreate).blockId
  if (!id) return
  const created = ws.getBlockById(id)
  if (!created) return
  // A dragged block brings its children (the number shadows in its sockets), and
  // any of them may be the one that declares the instrument — so ask the whole
  // little tree rather than just its root.
  for (const block of [created, ...created.getDescendants(false)]) {
    const instrument = blockDefinition(block.type)?.instrument
    if (instrument) {
      dispatchRevealInstruments([instrument])
      return
    }
  }
}

export default BlocksCanvas
