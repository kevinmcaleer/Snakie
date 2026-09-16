import { useCallback, useEffect, useMemo, useRef } from 'react'
import * as Blockly from 'blockly/core'
import { usePrompt } from './PromptModal'
import {
  BLOCK_CATEGORIES,
  buildSoftShellTheme,
  categoryStyleName,
  readThemeTokens,
  softShellWorkspaceOptions,
  type BlocklyThemeInput
} from '../lib/blocks/theme'
import { generateProgram, type GeneratedProgram } from '../lib/blocks/generator'
import { ledPinToken, setBoardPins } from '../lib/blocks/board-pins'
import { applyPinWarnings } from '../lib/blocks/pin-conflicts'
import { loadSelectedBoard, watchSelectedBoard } from './board-pin-source'
import { blockDefinition, blocksInCategory, installBlockDefinitions } from '../lib/blocks/registry'
import { installCorePalette } from '../lib/blocks/palette'
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
  /** Drop the footer and keep the Python — the escape from an unreadable file. */
  onGraduate?: () => void
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
  onGraduate
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
  const onGenerateRef = useRef(onGenerate)
  onGenerateRef.current = onGenerate
  const onEditRef = useRef(onEdit)
  onEditRef.current = onEdit
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

    const tokens = readThemeTokens(document.documentElement)
    const ws = Blockly.inject(host, {
      ...softShellWorkspaceOptions(tokens),
      toolbox: buildToolbox(),
      theme: Blockly.Theme.defineTheme(
        'snakie-soft-shell',
        buildSoftShellTheme(tokens) as BlocklyThemeInput
      )
    })
    wsRef.current = ws

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
        const program = { ...generateProgram(ws), workspace: json }
        // Keep the traceback mapper on the CURRENT program (#1015).
        sourceMapRef.current = program.sourceMap
        // Two blocks on one pin, a pin this board hasn't got, a pin that can't
        // do the job (#1012). The canvas is the only place that sees the whole
        // program at once, so it is where this is caught.
        applyPinWarnings(ws)
        onGenerateRef.current?.(program)
        onEditRef.current(program)
      }, REGENERATE_DEBOUNCE_MS)
    }
    ws.addChangeListener(listener)

    return () => {
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
        setBoardPins(
          board.pins.map((p) => ({ gpio: p.gpio, label: p.label, capabilities: p.capabilities })),
          ledPinToken(board.ledLabel)
        )
        // The warnings on screen were computed against the OLD board's pins, so
        // a board swap has to re-run them or a stale "this board has no GP22"
        // outlives the board that didn't.
        const ws = wsRef.current
        if (ws) applyPinWarnings(ws)
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

  // Load the document. Keyed on the FILE, not the JSON: the canvas is the source
  // of truth once it is up, so re-loading on every workspace change would fight
  // the user's own drag — the store's content is downstream of this canvas.
  useEffect(() => {
    const ws = wsRef.current
    if (!ws || peek || blocked) return
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
      const opened = { ...generateProgram(ws), workspace: loaded }
      sourceMapRef.current = opened.sourceMap
      onGenerateRef.current?.(opened)
      applyPinWarnings(ws)
      // Show the instruments this program draws into (#1013). On LOAD as well as
      // on a drag, because a turtle program whose picture goes nowhere is a
      // program that looks like it did nothing — which is exactly what happens
      // when a child saves their square, opens it the next day and presses Run.
      // Once per load rather than per block: the load fires a create event per
      // block, and revealing eighteen times would scroll the dock eighteen times.
      dispatchRevealInstruments(instrumentsUsedBy(ws))
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
  }, [fileId, peek, blocked])

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
    return <BlocksUnreadable types={unknown} onGraduate={onGraduate} />
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
 * Deliberately offers only the ONE action that cannot lose anything. "Install
 * what's missing" is #1017's job and we don't yet know where a block came from;
 * "open it anyway" is the overwrite this whole path exists to prevent. Doing
 * nothing is a real option and is spelled out, because for a file from a newer
 * Snakie it is the right one.
 */
function BlocksUnreadable({
  types,
  onGraduate
}: {
  types: readonly string[]
  onGraduate?: () => void
}): JSX.Element {
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
      {onGraduate && (
        <div className="blocks-unreadable__actions">
          <button type="button" className="btn btn--sm" onClick={onGraduate}>
            Keep the Python, drop the blocks
          </button>
        </div>
      )}
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
 * The toolbox: one category per entry in {@link BLOCK_CATEGORIES}, filled from
 * the block registry.
 *
 * Every category is shown even when it is empty, which is the state through most
 * of Phase 1. An empty `Turtle` says "turtle blocks go here and aren't built
 * yet"; hiding it would say "Snakie doesn't do turtles", which is the wrong
 * thing to tell someone who came here to draw one.
 */
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

function buildToolbox(): Blockly.utils.toolbox.ToolboxDefinition {
  return {
    kind: 'categoryToolbox',
    contents: BLOCK_CATEGORIES.map((c) => ({
      kind: 'category',
      name: c.name,
      categorystyle: categoryStyleName(c.id),
      contents: blocksInCategory(c.id).map((def) => ({
        kind: 'block',
        type: def.type,
        // A block dragged out of the flyout arrives with sensible values in its
        // sockets rather than holes a beginner has to discover how to fill.
        ...(def.toolbox ?? {})
      }))
    }))
  }
}

export default BlocksCanvas
