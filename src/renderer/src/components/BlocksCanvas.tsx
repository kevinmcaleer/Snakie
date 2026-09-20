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
import {
  EXTRAS_FIELD,
  extrasVisible,
  hasExtrasRow,
  setExtrasVisible
} from '../lib/blocks/palette/functions'
import { argNamesHidden, hasArgNames, revealArgNames } from '../lib/blocks/palette/python'
import { installSoftShellRenderers } from '../lib/blocks/renderer'
import {
  arrangeWorkspaceRoots,
  rootMoved,
  rootsUnmoved,
  separateWorkspaceRoots,
  type RootPlacement
} from '../lib/blocks/arrange'
import { installShelfFlyout, installZoomReset } from '../lib/blocks/zoom'
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
import { registerBlocksWorkspace } from '../lib/blocks/workspace-registry'
import { buildToolbox } from '../lib/blocks/toolbox'
import { installVariablesDrawer } from '../lib/blocks/variables-drawer'
import { installDuplicateShortcut } from '../lib/blocks/duplicate'
import type { Dialect } from '../../../shared/dialect'
import { useHelpDialect } from '../hooks/useHelpDialect'
import { useEditorSettings, type BlockLevel } from '../store/settings'
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

/**
 * A pending overlap pass, one per workspace — see `scheduleSeparation`.
 *
 * Module-level rather than a ref so the pass belongs to the workspace and not
 * to the render that registered the listener; a canvas is injected once and
 * the listener with it.
 */
const separationTimers = new WeakMap<Blockly.Workspace, ReturnType<typeof setTimeout>>()

/**
 * Once the burst of events from one edit has landed, move any root that now
 * overlaps another out of the way — keeping the edited root where it is.
 *
 * The moves it makes are ordinary events in the edit's own group, so one ⌘Z
 * takes back the edit and the tidy-up together, and the listener writes the
 * new positions to the file the way it writes any move.
 */
function scheduleSeparation(ws: Blockly.WorkspaceSvg, event: Blockly.Events.Abstract): void {
  const pending = separationTimers.get(ws)
  if (pending) clearTimeout(pending)
  const edited = 'blockId' in event ? (event as { blockId?: string }).blockId : undefined
  const group = event.group
  separationTimers.set(
    ws,
    setTimeout(() => {
      separationTimers.delete(ws)
      if (ws.isDragging()) return
      const root = edited ? ws.getBlockById(edited)?.getRootBlock() : null
      const fixed = new Set(root ? [root.id] : [])
      const was = Blockly.Events.getGroup()
      Blockly.Events.setGroup(group || true)
      try {
        separateWorkspaceRoots(ws, fixed)
      } finally {
        Blockly.Events.setGroup(was)
      }
    }, SEPARATE_DEBOUNCE_MS)
  )
}

/** After the regenerate debounce, so a burst of events is one pass. */
const SEPARATE_DEBOUNCE_MS = REGENERATE_DEBOUNCE_MS + 30

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
  /**
   * These blocks are Snakie's READING of somebody's Python, rather than
   * an arrangement a learner made and saved.
   *
   * It decides one thing: whether the canvas may lay the top-level stacks out
   * for itself. A converted file has no layout to respect — `python-to-blocks`
   * only numbers the roots so their order survives — so the canvas measures
   * them and puts the program in one column with the functions beside it. A
   * file whose footer matched its code was arranged by the person who saved it,
   * and tidying that up behind their back would throw away work.
   */
  derived?: boolean
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
  reloadNonce = 0,
  derived = false
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
  /**
   * Where the last arrange put each root, or `null` for a workspace we
   * did not arrange — a stored layout somebody made themselves.
   *
   * Kept so a late measurement can tell its own arrangement from a learner's:
   * see the webfont effect below.
   */
  const arrangedRef = useRef<Map<string, RootPlacement> | null>(null)
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
  // Which of Blockly's three geometries to draw in (Settings ▸ Appearance).
  // Read here rather than passed down: it is a preference, not a property of
  // the document, and every caller of this component would just be forwarding
  // it.
  const { blockShape, blockLevel } = useEditorSettings()
  /**
   * Simple or advanced drawers (#1210) — a REF for the injection, like the
   * dialect below, and a dependency of the rebuild effect, so a flip in
   * Settings re-filters the toolbox of a canvas that is already open.
   */
  const blockLevelRef = useRef(blockLevel)
  blockLevelRef.current = blockLevel
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
  /** And the level it was built for (#1210), for the same reason. */
  const toolboxLevelRef = useRef<BlockLevel | null>(null)

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

  // Inject once — and again if the BLOCK SHAPE changes, which is the one
  // setting that cannot be applied to a live workspace: Blockly fixes its
  // renderer when the workspace is created, and there is no setter for it. The
  // teardown below is the same one a workspace switch already runs, and the
  // load effect (keyed on the shape too) puts the file straight back.
  //
  // The SKIN is not like that: a theme is applied separately below, so turning
  // the app dark never tears the canvas down.
  useEffect(() => {
    const host = hostRef.current
    if (!host || peek || blocked) return

    // Blockly has to know the registered blocks' shapes before a workspace can
    // hold one. Here rather than at module load, so a block a part or plugin
    // registers later (#1017) is installed by the next canvas that opens.
    installBlockDefinitions()
    // And the Soft Shell geometries, which the options below name one of.
    // Registering a renderer Blockly has never heard of throws during injection.
    installSoftShellRenderers()
    // And the shelf that holds still while the canvas zooms (#1150). Also
    // before injection: the flyout class is read out of the registry as the
    // workspace is built.
    installShelfFlyout()

    const tokens = readThemeTokens(document.documentElement)
    const ws = Blockly.inject(host, {
      ...softShellWorkspaceOptions(tokens, blockShape),
      toolbox: buildToolbox(dialectRef.current, blockLevelRef.current),
      theme: Blockly.Theme.defineTheme(
        'snakie-soft-shell',
        buildSoftShellTheme(tokens) as BlocklyThemeInput
      )
    })
    wsRef.current = ws
    // Publish the workspace so things OUTSIDE this component — the PDF export's
    // blocks pages (#1112) — can walk the learner's stacks. Unregistered in the
    // cleanup below, because reading a disposed workspace is a crash.
    const unregisterWorkspace = registerBlocksWorkspace(ws)
    toolboxDialectRef.current = dialectRef.current
    toolboxLevelRef.current = blockLevelRef.current

    // Blockly's "reset zoom" control becomes the fit/100% toggle (#1150). After
    // injection, because it works on the control Blockly has just drawn.
    const restoreZoomReset = installZoomReset(ws)

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
      // KEEP THE ISLANDS APART (#1062). A block dropped into a function makes
      // it taller, and the function below did not move — so the two now share
      // pixels and the join is unreadable. After each edit settles, whatever
      // root the edit was in stays put and the roots it has grown into are
      // moved out from under it. Not while a block is in the air: a drag
      // crosses every stack on its way, and pushing them all aside as it
      // passes would scatter the canvas for one gesture. The drop is an event
      // of its own and gets its own pass.
      scheduleSeparation(ws, event)
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
      restoreZoomReset()
      ws.removeChangeListener(pointing)
      if (debounceRef.current) clearTimeout(debounceRef.current)
      const separation = separationTimers.get(ws)
      if (separation) clearTimeout(separation)
      separationTimers.delete(ws)
      ws.removeChangeListener(listener)
      unregisterWorkspace()
      ws.dispose()
      wsRef.current = null
      lastLoadedRef.current = ''
      // The arrangement belonged to the workspace that just went away; a new
      // one measures for itself, and the next load is a first load rather than
      // a reload of a canvas that no longer exists.
      arrangedRef.current = null
      loadedFileRef.current = null
    }
  }, [peek, blocked, blockShape])

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
    if (
      paletteNonce === 0 &&
      toolboxDialectRef.current === dialect &&
      toolboxLevelRef.current === blockLevel
    )
      return
    try {
      installBlockDefinitions()
      ws.updateToolbox(buildToolbox(dialect, blockLevel))
      toolboxDialectRef.current = dialect
      toolboxLevelRef.current = blockLevel
    } catch (err) {
      console.warn('[blocks] could not rebuild the toolbox', err)
    }
  }, [paletteNonce, dialect, blockLevel, peek, blocked])

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
      // A ROOT WE PUT THERE IS NOT A ROOT THEY PUT THERE. On a derived
      // file the previous positions are mostly our own arrangement, and putting
      // those back would pin the layout to whatever the program looked like
      // when it was first opened — so a function that has since grown would be
      // laid out for its old height and drawn over the one below it. Only the
      // roots that have MOVED since we arranged them are the learner's, and
      // only those are worth restoring; the rest take the fresh measurement.
      const arranged = arrangedRef.current
      for (const block of ws.getTopBlocks(false)) {
        const at = block.getRelativeToSurfaceXY()
        if (!rootMoved(at, arranged?.get(block.id))) continue
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
      // Back where they were. Only roots: everything else is positioned by the
      // block it is connected to, and moving those would be a fight with
      // Blockly's own layout rather than a courtesy.
      for (const block of ws.getTopBlocks(false)) {
        const at = places.get(block.id)
        if (!at) continue
        const now = block.getRelativeToSurfaceXY()
        block.moveBy(at.x - now.x, at.y - now.y)
      }
      // LAY THE ROOTS OUT, NOW THEY CAN BE MEASURED. The document only
      // numbers them — the program in one column with the functions in
      // columns beside it is worked out here, from what Blockly actually
      // drew, around the roots just put back. A file the learner arranged
      // themselves keeps its layout, but not its overlaps: an island that has
      // grown into the one below it is moved out from under it. BEFORE the
      // re-serialise below, so the positions this writes are part of the
      // "nothing has changed since it loaded" baseline rather than an edit the
      // listener would write back to the file for the crime of opening it.
      const canvas = ws as Blockly.WorkspaceSvg
      if (derived) {
        arrangedRef.current = arrangeWorkspaceRoots(canvas, new Set(places.keys()))
      } else {
        arrangedRef.current = null
        separateWorkspaceRoots(canvas)
      }
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
      // Still selected, so a reconversion cannot steal the highlight out
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
  }, [fileId, reloadNonce, peek, blocked, derived, blockShape])

  /**
   * MEASURE AGAIN ONCE THE FONT ARRIVES.
   *
   * The arrange above asks each block how big it is, and a block is only as big
   * as the text in it — so a canvas laid out while Plus Jakarta Sans is still
   * downloading is laid out against the fallback face. The difference is small
   * and it is not nothing: the same file measured 506px for its first root on a
   * cold load and 530px on a warm one, which is an overlap's worth.
   *
   * `document.fonts.ready` resolves immediately on a warm load, so this is
   * normally one wasted comparison. When it does fire late, it re-arranges ONLY
   * IF every root is still exactly where the arrange put it — the moment the
   * learner has dragged anything, their layout is the layout and a webfont is
   * not a reason to undo it.
   */
  useEffect(() => {
    if (!derived || peek || blocked) return
    let cancelled = false
    void document.fonts?.ready.then(() => {
      const ws = wsRef.current
      const applied = arrangedRef.current
      if (cancelled || !ws || !applied || !rootsUnmoved(ws, applied)) return
      Blockly.Events.disable()
      try {
        arrangedRef.current = arrangeWorkspaceRoots(ws)
      } finally {
        Blockly.Events.enable()
      }
    })
    return () => {
      cancelled = true
    }
  }, [fileId, reloadNonce, peek, blocked, derived, blockShape])

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
  installFunctionExtrasMenu()
  installCallArgNamesMenu()
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

/**
 * A `def` block's right-click **Add extra parameters…** (#1134).
 *
 * The parameters Blockly's mutator cannot model — a default value, a `*args`,
 * a `**kwargs` — live in a text field on the block, and that field's row is
 * hidden while it is empty so the ordinary `def` block stays ordinary. This is
 * how a learner asks for it: the row appears and its editor opens, ready to be
 * typed into. Emptied and closed again, it puts itself away.
 *
 * Hidden — rather than greyed out — for a block that already shows the row, and
 * for every block that has no such row at all, which is all of them but two.
 */
function installFunctionExtrasMenu(): void {
  const id = 'snakieFunctionExtras'
  if (Blockly.ContextMenuRegistry.registry.getItem(id)) return
  Blockly.ContextMenuRegistry.registry.register({
    id,
    scopeType: Blockly.ContextMenuRegistry.ScopeType.BLOCK,
    // Below "Show me the Python" and Help: it edits this block rather than
    // explaining it, so it sits with Blockly's own editing items.
    weight: 98,
    displayText: 'Add extra parameters…',
    preconditionFn: (scope) => {
      const block = scope.block
      if (!block || !hasExtrasRow(block)) return 'hidden'
      return extrasVisible(block) ? 'hidden' : 'enabled'
    },
    callback: (scope) => {
      const block = scope.block
      if (!block) return
      setExtrasVisible(block, true)
      // After the render the row was just queued for, so the editor opens over
      // a field that is actually on screen.
      const field = block.getField(EXTRAS_FIELD)
      if (field) setTimeout(() => field.showEditor(), 0)
    }
  })
}

/**
 * A `call` block's right-click **Name the arguments…** (#1163).
 *
 * Each argument socket carries a box for the keyword name that goes in front of
 * it — `pixels.fill(colour=RED)` — and the box is hidden while it is empty, so
 * an ordinary positional call reads as the call it makes rather than growing an
 * empty pill and an `=` per argument. This is how a learner asks for one.
 *
 * Every hidden box on the block at once, and the editor opens on the first that
 * has no name: the learner asking cannot point at which argument they meant,
 * and the reveal lapses the moment that editor closes — see `palette/python.ts`.
 */
function installCallArgNamesMenu(): void {
  const id = 'snakieCallArgNames'
  if (Blockly.ContextMenuRegistry.registry.getItem(id)) return
  Blockly.ContextMenuRegistry.registry.register({
    id,
    scopeType: Blockly.ContextMenuRegistry.ScopeType.BLOCK,
    // Beside "Add extra parameters…", which is the same kind of item: it edits
    // this block rather than explaining it.
    weight: 98,
    displayText: 'Name the arguments…',
    preconditionFn: (scope) => {
      const block = scope.block
      if (!block || !hasArgNames(block)) return 'hidden'
      return argNamesHidden(block) ? 'enabled' : 'hidden'
    },
    callback: (scope) => {
      if (!scope.block) return
      const field = revealArgNames(scope.block)
      // After the render the boxes were just queued for, so the editor opens
      // over a field that is actually on screen.
      if (field) setTimeout(() => field.showEditor(), 0)
    }
  })
}

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
