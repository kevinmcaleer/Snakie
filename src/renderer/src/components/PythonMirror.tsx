import { useEffect, useRef } from 'react'
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api'
import 'monaco-editor/esm/vs/editor/editor.all'
import 'monaco-editor/esm/vs/basic-languages/python/python.contribution'
import './monaco-setup'
import {
  editorMetricsFor,
  ensureMonacoThemes,
  monacoTheme,
  readDocTheme,
  readEditorTheme
} from './monaco-theme'
import './PythonMirror.css'

/**
 * THE PYTHON MIRROR (#1010, epic #1007).
 * =============================================================================
 *
 * The Python half of the blocks split: the code the blocks wrote, beside the
 * blocks that wrote it, regenerated on every change. This is the teaching
 * mechanism of the whole epic — a learner who watches the text grow as they drag
 * is already reading it, and the step to Monaco is a step across rather than off
 * a cliff.
 *
 * WHY MONACO, for a pane nobody can type in. Because "the same theme and font as
 * the editor" is the point: the graduation moment (#1016) should change which
 * pane is big, not what the code looks like. Monaco gives that for free, in
 * every editor colour theme the user might have picked, with real Python
 * tokenisation — and it gives #1015 and #1016 the decorations API to highlight
 * the line a traceback names and the lines a hovered block owns. The chunk is
 * shared with the editor, so a blocks file costs the download once.
 *
 * A MIRROR, NOT A SECOND EDITOR. The blocks are the source of truth, so this is
 * read-only. But read-only as an AFFORDANCE, not a locked box: Monaco swallows
 * keystrokes in a read-only model and shows nothing, which is the worst answer a
 * teaching tool can give — "I pressed a key and the computer ignored me". So the
 * attempt is CAUGHT and answered with the graduation offer, turning the
 * commonest accident in a split view into the milestone the epic is built
 * around.
 */
export interface PythonMirrorProps {
  /** The generated MicroPython, footer already stripped. */
  code: string
  /** The user tried to type here — the caller offers to graduate the file. */
  onEditAttempt?: () => void
  /**
   * Lines to mark, 1-based — the lines the hovered or selected block wrote
   * (#1016). Empty means no decorations.
   */
  highlightLines?: readonly number[]
  /**
   * A line was clicked (#1016) — the caller selects the block that wrote it.
   *
   * The other direction of the link, and the one that teaches: a learner who
   * cannot yet read a line of Python can still point at it and be shown which
   * block put it there.
   */
  onLineClick?: (line: number) => void
  /**
   * Scroll this 1-based line into view, without selecting anything.
   *
   * Set when a hovered block's code is off-screen: highlighting lines nobody can
   * see is the same as not highlighting them.
   */
  revealLine?: number | null
}

export function PythonMirror({
  code,
  onEditAttempt,
  highlightLines,
  onLineClick,
  revealLine
}: PythonMirrorProps): JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)
  const decorationsRef = useRef<monaco.editor.IEditorDecorationsCollection | null>(null)
  const onEditAttemptRef = useRef(onEditAttempt)
  onEditAttemptRef.current = onEditAttempt
  const onLineClickRef = useRef(onLineClick)
  onLineClickRef.current = onLineClick

  // Create once. The model is ours alone — deliberately NOT one of the editor's
  // per-file models, because sharing one would give the mirror the editor's undo
  // history and let a read-only pane's view state fight the real editor's.
  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    ensureMonacoThemes()
    const skin = readDocTheme()
    const editor = monaco.editor.create(host, {
      value: '',
      language: 'python',
      theme: monacoTheme(skin, readEditorTheme()),
      readOnly: true,
      // Monaco's own read-only tooltip says "Cannot edit in read-only editor",
      // which is true and useless. We answer the attempt properly instead.
      readOnlyMessage: { value: 'The blocks write this code — press a key to graduate to Python.' },
      automaticLayout: true,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      lineNumbersMinChars: 3,
      folding: false,
      // Nothing here is editable, so every editing affordance is noise that
      // invites a click that can't do anything.
      contextmenu: false,
      occurrencesHighlight: 'off',
      renderLineHighlight: 'none',
      scrollbar: { vertical: 'auto', horizontal: 'auto' },
      wordWrap: 'off',
      ...editorMetricsFor(skin, ruleSpacing())
    })
    editorRef.current = editor
    decorationsRef.current = editor.createDecorationsCollection()

    // A read-only Monaco still receives keystrokes; it just does nothing with
    // them. Catch the ones that LOOK like typing and answer them.
    const keys = editor.onKeyDown((e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return // let copy, find, navigation through
      if (!isTypingKey(e.browserEvent.key)) return
      e.preventDefault()
      e.stopPropagation()
      onEditAttemptRef.current?.()
    })

    // Clicking a line asks "which block wrote this?" (#1016). Monaco's own
    // cursor still moves, which is right: the caret marks what they pointed at.
    const clicks = editor.onMouseDown((e) => {
      const line = e.target.position?.lineNumber
      if (typeof line === 'number') onLineClickRef.current?.(line)
    })

    return () => {
      clicks.dispose()
      keys.dispose()
      editor.getModel()?.dispose()
      editor.dispose()
      editorRef.current = null
      decorationsRef.current = null
    }
  }, [])

  // Follow the code. `setValue` rather than a fresh model so the scroll position
  // survives a regeneration — which happens on every block the learner drags,
  // and a pane that jumps to the top each time is a pane you cannot read.
  useEffect(() => {
    const editor = editorRef.current
    if (!editor) return
    if (editor.getValue() !== code) editor.setValue(code)
  }, [code])

  // Follow the app's skin and the user's editor colour theme, the same way the
  // real editor does — the mirror and the editor must never be different colours.
  useEffect(() => {
    const apply = (): void => {
      const skin = readDocTheme()
      monaco.editor.setTheme(monacoTheme(skin, readEditorTheme()))
      editorRef.current?.updateOptions(editorMetricsFor(skin, ruleSpacing()))
    }
    apply()
    const observer = new MutationObserver(apply)
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme', 'data-editor-theme']
    })
    return () => observer.disconnect()
  }, [])

  // Bring a linked line into view (#1016). `InCenterIfOutsideViewport` rather
  // than a plain reveal, so hovering block after block down a long program
  // doesn't scroll the pane on every one — only when the answer is off-screen.
  useEffect(() => {
    if (revealLine == null) return
    editorRef.current?.revealLineInCenterIfOutsideViewport(revealLine)
  }, [revealLine])

  // Whole-line decorations on the lines the caller names: the lines a hovered
  // block wrote (#1016). Cleared when there are none, so a highlight can't
  // outlive the hover that produced it.
  useEffect(() => {
    const collection = decorationsRef.current
    if (!collection) return
    collection.set(
      (highlightLines ?? []).map((line) => ({
        range: new monaco.Range(line, 1, line, 1),
        options: { isWholeLine: true, className: 'pymirror__hit' }
      }))
    )
  }, [highlightLines])

  return (
    <div className="pymirror">
      <div className="pymirror__header">
        <span className="pymirror__title">Python</span>
        <span
          className="pymirror__badge"
          title="The blocks write this — edit the blocks to change it"
        >
          read-only
        </span>
        {/* The link is invisible until you try it, so say it once. This is the
            teaching mechanism of the whole epic and it should not be a secret. */}
        {onLineClick && (
          <span className="pymirror__hint">click a line to find its block</span>
        )}
      </div>
      {code === '' && (
        <p className="pymirror__empty">Drag a block onto the canvas and its Python appears here.</p>
      )}
      <div className="pymirror__body" ref={hostRef} data-testid="python-mirror-host" />
    </div>
  )
}

/**
 * Does this key mean "I am trying to write in here"?
 *
 * Single characters plus the three that delete or split a line. Arrows, Tab,
 * Escape and the function keys are navigation, and answering those with a modal
 * would make the pane unreadable with a keyboard (epic #188).
 */
function isTypingKey(key: string): boolean {
  return key.length === 1 || key === 'Backspace' || key === 'Delete' || key === 'Enter'
}

/**
 * The ruled-paper line spacing the app is currently set to, in px.
 *
 * Read from the CSS custom property rather than the settings store: the store is
 * a React context the mirror would otherwise have to be inside, and the property
 * is what the paper gradient itself uses — so the text lands on the lines.
 */
function ruleSpacing(): number {
  const raw = getComputedStyle(document.documentElement)
    .getPropertyValue('--editor-rule-spacing')
    .trim()
  const px = Number.parseFloat(raw)
  return Number.isFinite(px) && px > 0 ? px : 30
}

export default PythonMirror
