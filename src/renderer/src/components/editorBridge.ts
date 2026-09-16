import type * as monaco from 'monaco-editor/esm/vs/editor/editor.api'

/**
 * Editor access seam (issue #92).
 *
 * The single Monaco editor instance lives in a `useRef` inside `MonacoEditor`.
 * The Find & Replace panel — rendered by `EditorArea`, a sibling of the editor
 * host — needs imperative access to that instance to drive Monaco's search /
 * edit APIs, without `MonacoEditor` exposing its internals through props or a
 * re-render-coupling context (which would disturb the model/lint wiring).
 *
 * This is a tiny module-level registry: `MonacoEditor` publishes its instance
 * here on create (and clears it on dispose), and consumers read it imperatively
 * via `getActiveEditor()`. `subscribe()` lets a consumer react to the editor
 * appearing/disappearing (e.g. so the Find panel can re-bind after the lazy
 * Monaco chunk mounts). Mirrors how Monaco itself is a process-wide singleton.
 */

type Editor = monaco.editor.IStandaloneCodeEditor

/**
 * DOM event the editor dispatches when the user presses the find/replace
 * shortcut. `MonacoEditor` rebinds Cmd/Ctrl-F and Cmd/Ctrl-H to this event so
 * Monaco's own find widget never opens and the custom panel (listened for in
 * `EditorArea`) is what shows instead. `detail.withReplace` distinguishes
 * Cmd/Ctrl-F (find) from Cmd/Ctrl-H (find + replace).
 */
export const FIND_EVENT = 'snakie:open-find'

export interface FindEventDetail {
  withReplace: boolean
}

/** Dispatch the open-find event (used by the editor's keybinding commands). */
export function dispatchOpenFind(withReplace: boolean): void {
  window.dispatchEvent(new CustomEvent<FindEventDetail>(FIND_EVENT, { detail: { withReplace } }))
}

/** Cross-panel "open help" event: switch the left sidebar to the Help view and
 *  open a specific help article (fired by an instrument's `?` button). */
export const HELP_EVENT = 'snakie:open-help'

export interface HelpEventDetail {
  /** The help article id to open, e.g. `inst-scope`. */
  articleId: string
}

/** Dispatch the open-help event: reveal the Help view + open `articleId`. */
export function dispatchOpenHelp(articleId: string): void {
  window.dispatchEvent(new CustomEvent<HelpEventDetail>(HELP_EVENT, { detail: { articleId } }))
}

/**
 * "Reveal this instrument in the dock" (#1013, epic #1007).
 *
 * Fired by the block canvas when a learner drags out a block that belongs to an
 * instrument — a turtle block needs the Turtle instrument on screen, because the
 * drawing IS the output and a program that draws into a panel nobody opened looks
 * like a program that did nothing.
 *
 * An EVENT rather than a prop, for the same reason as the rest of this file: the
 * canvas is four components deep inside a lazy chunk and the dock's visibility
 * lives in `AppShell`. Threading a callback down would mean touching every layer
 * between, and #1014 adds a block category where EVERY block does this.
 *
 * Keyed by the instrument id from `instruments-registry.ts`, so a block names an
 * instrument that demonstrably exists rather than a string the dock has to guess
 * at.
 */
export const REVEAL_INSTRUMENT_EVENT = 'snakie:reveal-instrument'

export interface RevealInstrumentDetail {
  /**
   * The instrument ids, e.g. `['turtle']`.
   *
   * A LIST, not one id, and that is not future-proofing. The dock's visibility
   * is a single stored object written whole: four separate events fire in one
   * synchronous burst, each reads the same pre-render state, and each overwrites
   * the last — so opening a program that drives four instruments revealed one of
   * them. The caller already knows the whole set; sending it as one event is
   * what lets the shell write it once.
   */
  ids: readonly string[]
}

/** Ask the shell to show these instruments in the dock, opening the dock if needed. */
export function dispatchRevealInstruments(ids: readonly string[]): void {
  if (ids.length === 0) return
  window.dispatchEvent(
    new CustomEvent<RevealInstrumentDetail>(REVEAL_INSTRUMENT_EVENT, { detail: { ids } })
  )
}

/**
 * "A program started or stopped" (#1015, epic #1007).
 *
 * The block canvas needs to know, for two reasons: a new run must clear the
 * error badges the LAST run left on the blocks (otherwise a fixed program still
 * looks broken), and while a program is running the canvas glows — the "my code
 * is alive" feedback Scratch gets right and a text editor never gives you.
 *
 * An EVENT, because Run lives in the toolbar and the canvas is four components
 * deep inside a lazy chunk, and because the device layer has no opinion about
 * blocks. Fired by `Toolbar` for every path that starts or ends a run, including
 * the board dropping out from under one.
 */
export const PROGRAM_RUN_EVENT = 'snakie:program-run'

export interface ProgramRunDetail {
  /** True when a program has just been sent to the board; false when it ended. */
  running: boolean
}

/** Tell the canvas a program started (`true`) or stopped (`false`). */
export function dispatchProgramRunState(running: boolean): void {
  window.dispatchEvent(
    new CustomEvent<ProgramRunDetail>(PROGRAM_RUN_EVENT, { detail: { running } })
  )
}

/**
 * "This program needs a Snakie library the board hasn't got" (#1015).
 *
 * Raised from a traceback rather than from a connection check: the install
 * banner appears when a board connects without the library, but a child who
 * dismissed it — or whose board has an OLD copy — meets the problem again as an
 * `ImportError` they cannot act on. This brings the one-click install back.
 */
export const NEED_LIBRARY_EVENT = 'snakie:need-library'

export interface NeedLibraryDetail {
  /** Which library: the instruments bundle, or turtle graphics. */
  library: 'instruments' | 'turtle'
}

/** Ask the shell to re-offer `library`'s one-click install. */
export function dispatchNeedLibrary(library: 'instruments' | 'turtle'): void {
  window.dispatchEvent(
    new CustomEvent<NeedLibraryDetail>(NEED_LIBRARY_EVENT, { detail: { library } })
  )
}

/**
 * "Close the active tab" (#915), fired by File ▸ Close Tab.
 *
 * An EVENT rather than a store call, because closing a tab is not just removing
 * it: `EditorTabs` asks first when the buffer is dirty, and a menu item that
 * went straight to the store would discard unsaved work while the × beside it
 * asks — the sort of inconsistency nobody reports and everybody gets bitten by
 * once. This routes the menu through the one implementation that prompts.
 *
 * It matters on the desktop specifically: ⌘W is now a menu ACCELERATOR, so
 * Electron takes the key before the renderer sees a `keydown`, and the tabs'
 * own shortcut handler never fires. That handler stays for the web build, which
 * has no menu at all.
 */
export const CLOSE_TAB_EVENT = 'snakie:close-tab'

/** Ask the editor tabs to close the active tab, prompting if it is dirty. */
export function dispatchCloseTab(): void {
  window.dispatchEvent(new CustomEvent(CLOSE_TAB_EVENT))
}

let current: Editor | null = null
const listeners = new Set<(editor: Editor | null) => void>()

/** Publish the live Monaco editor (or null when it is torn down). */
export function setActiveEditor(editor: Editor | null): void {
  current = editor
  for (const listener of listeners) listener(editor)
}

/** The live Monaco editor instance, or null when none is mounted. */
export function getActiveEditor(): Editor | null {
  return current
}

/**
 * Subscribe to editor availability changes. The callback fires immediately with
 * the current value and on every subsequent change. Returns an unsubscribe fn.
 */
export function subscribeActiveEditor(listener: (editor: Editor | null) => void): () => void {
  listeners.add(listener)
  listener(current)
  return () => {
    listeners.delete(listener)
  }
}
