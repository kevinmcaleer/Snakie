import { useCallback, useEffect, useMemo, useRef } from 'react'
import * as Blockly from 'blockly/core'
import * as BlocklyEn from 'blockly/msg/en'
import { usePrompt } from './PromptModal'
import {
  BLOCK_CATEGORIES,
  buildSoftShellTheme,
  categoryStyleName,
  readThemeTokens,
  softShellWorkspaceOptions,
  type BlocklyThemeInput
} from '../lib/blocks/theme'
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
 * out, and the `window.prompt` bridge. It does NOT own the toolbox CONTENTS —
 * the categories exist here (from the theme's one list, so a category can never
 * have a colour but no home) and the blocks that go in them arrive over #1011 →
 * #1014, #1017 and #1018. An empty category is honest at this stage; a category
 * list invented twice would not be.
 *
 * THE UNCONTROLLED SEAM. Blockly owns the DOM and its own undo stack, so this
 * is deliberately NOT a controlled component. The file's JSON is loaded once per
 * document, and after that the canvas is the source of truth until the user
 * opens something else — `lastLoadedRef` is what stops an `onChange` echoing
 * back through the store and re-loading the workspace under the user's cursor,
 * which resets the scroll position and eats the undo history.
 */
export interface BlocksCanvasProps {
  /** Identity of the document on screen — a change here means "load this". */
  fileId: string
  /** The file's serialised workspace. */
  workspace: BlocksWorkspace
  /** The user moved blocks: the new workspace JSON. Debounced by the caller. */
  onChange: (workspace: BlocksWorkspace) => void
  /** Collapsed to a peek strip by the `Python` view mode — skip the injection. */
  peek?: boolean
  /** Click handler for the peek strip (restores the split). */
  onExpand?: () => void
  /** Drop the footer and keep the Python — the escape from an unreadable file. */
  onGraduate?: () => void
}

// `blockly/core` ships with an EMPTY message table — the locale packs are
// separate, and `blockly` (the umbrella entry point) is what normally pulls
// `msg/en` in along with the stock block set we deliberately don't want. Without
// this, `inject` dies inside its own `setInitialAriaContext` reading
// `Msg.WORKSPACE_ARIA_LABEL.replace(…)` off `undefined`: the canvas never
// appears and the first thing a learner sees is a blank pane. Module scope, not
// an effect — it must be true before the first `inject`, and it is global to
// Blockly either way.
Blockly.setLocale(BlocklyEn as unknown as Record<string, string>)

export function BlocksCanvas({
  fileId,
  workspace,
  onChange,
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
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

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
      onChangeRef.current(json)
    }
    ws.addChangeListener(listener)

    return () => {
      ws.removeChangeListener(listener)
      ws.dispose()
      wsRef.current = null
      lastLoadedRef.current = ''
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
      lastLoadedRef.current = JSON.stringify(
        Blockly.serialization.workspaces.save(ws) as BlocksWorkspace
      )
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
 * The toolbox skeleton: one category per entry in {@link BLOCK_CATEGORIES}.
 *
 * Contents arrive with the palette issues (#1011–#1014, #1017, #1018). Built
 * from the theme's list rather than a second one here, so a category can never
 * end up with a colour and no home, or a home and no colour.
 */
function buildToolbox(): Blockly.utils.toolbox.ToolboxDefinition {
  return {
    kind: 'categoryToolbox',
    contents: BLOCK_CATEGORIES.map((c) => ({
      kind: 'category',
      name: c.name,
      categorystyle: categoryStyleName(c.id),
      contents: []
    }))
  }
}

export default BlocksCanvas
