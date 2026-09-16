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
import './PythonPane.css'

/**
 * THE PYTHON PANE (#1010, made two-way by #1034).
 * =============================================================================
 *
 * The code half of the blocks split: the Python beside the blocks, in the same
 * font and the same colours as the editor, because "the same as the editor" is
 * the point — moving between them should change which pane is big, not what the
 * code looks like.
 *
 * IT USED TO BE A MIRROR, and read-only, because blocks were the source of
 * truth and code was derived. #1034 inverts that: **the `.py` is the program**,
 * and blocks and text are two views of it. So this is an editor, and typing in
 * it is not an accident to be answered with a modal — it is the other way of
 * writing the same program.
 *
 * What makes that safe is #1019: converting code back into blocks cannot fail,
 * only be uglier, because a line nobody can classify becomes a raw Python block
 * holding that exact line. There is no door between the two halves, so there is
 * nothing to warn anybody about.
 *
 * THE ONE PIECE OF BOOKKEEPING that matters here: an edit the CALLER pushed in
 * must not come back out as an edit the user made. Monaco fires its change
 * event for `setValue` exactly as it does for typing, and without the guard
 * below a block dragged on the canvas would regenerate the code, push it here,
 * read it back as a code edit, and re-convert it to blocks — a loop with the
 * learner's program inside it.
 */
export interface PythonPaneProps {
  /** The program's MicroPython, footer already stripped. */
  code: string
  /**
   * The user typed. The caller converts it back into blocks (#1019) — debounced,
   * because every keystroke is a change and a program is not.
   */
  onCodeChange?: (code: string) => void
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
  /**
   * Are the blocks on screen BESIDE this pane right now? (#1062)
   *
   * Both of this header's messages are about the other half of the split —
   * "click a line to find its block", and the empty state's "drag a block onto
   * the canvas". In the code-only view there is no canvas to click through to
   * or drag onto, so they were pointing at something the learner could not see.
   * The link itself still works; only the invitations to use it are hidden.
   */
  linked?: boolean
}

export function PythonPane({
  code,
  onCodeChange,
  highlightLines,
  onLineClick,
  revealLine,
  linked = false
}: PythonPaneProps): JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)
  const decorationsRef = useRef<monaco.editor.IEditorDecorationsCollection | null>(null)
  const onCodeChangeRef = useRef(onCodeChange)
  onCodeChangeRef.current = onCodeChange
  /** True while the caller's own text is being pushed in — see the header. */
  const pushingRef = useRef(false)
  const onLineClickRef = useRef(onLineClick)
  onLineClickRef.current = onLineClick

  // Create once. The model is ours alone — deliberately NOT one of the editor's
  // per-file models, because sharing one would give this pane the editor's undo
  // history, and typing here would then be undoable from the other tab.
  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    ensureMonacoThemes()
    const skin = readDocTheme()
    const editor = monaco.editor.create(host, {
      value: '',
      language: 'python',
      theme: monacoTheme(skin, readEditorTheme()),
      readOnly: false,
      automaticLayout: true,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      lineNumbersMinChars: 3,
      folding: false,
      contextmenu: true,
      occurrencesHighlight: 'off',
      renderLineHighlight: 'line',
      // OFF, as it is in the main editor (`MonacoEditor.tsx`). Sticky scroll
      // pins the enclosing `def`/`class`/`if` to the top of the pane, and it
      // cannot work here: every theme paints `editor.background` TRANSPARENT so
      // the CSS ruled paper shows through and scrolls with the text, and Monaco
      // derives the sticky header's fill from that same colour. The pinned
      // lines came out see-through, with the code scrolling underneath showing
      // straight through them — both halves illegible. Giving it an opaque
      // surface of its own (`editorStickyScroll.background`) is what it would
      // take; until someone wants the feature enough to do that, off is honest.
      stickyScroll: { enabled: false },
      scrollbar: { vertical: 'auto', horizontal: 'auto' },
      wordWrap: 'off',
      ...editorMetricsFor(skin, ruleSpacing())
    })
    editorRef.current = editor
    decorationsRef.current = editor.createDecorationsCollection()

    // The user typed. Anything the CALLER pushed in is skipped, or a block
    // dragged on the canvas would loop back round through here.
    const keys = editor.onDidChangeModelContent(() => {
      if (pushingRef.current) return
      onCodeChangeRef.current?.(editor.getValue())
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
    if (editor.getValue() === code) return
    // Guarded: `setValue` fires the change event exactly as typing does.
    pushingRef.current = true
    try {
      editor.setValue(code)
    } finally {
      pushingRef.current = false
    }
  }, [code])

  // Follow the app's skin and the user's editor colour theme, the same way the
  // real editor does — the two must never be different colours.
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
        options: { isWholeLine: true, className: 'python-pane__hit' }
      }))
    )
  }, [highlightLines])

  return (
    <div className="python-pane">
      <div className="python-pane__header">
        {/* MICROPYTHON, not PYTHON. The generator writes MicroPython — that is
            the whole premise of the epic — and a learner who graduates from
            this pane is graduating to the language named on it. The narrow
            layout's tab keeps the short word: it sits beside "Blocks" in a
            two-tab strip under 720px, where the long one does not fit. */}
        <span className="python-pane__title">MicroPython</span>
        {/* The link is invisible until you try it, so say it once. This is the
            teaching mechanism of the whole epic and it should not be a secret. */}
        {onLineClick && linked && (
          <span className="python-pane__hint">click a line to find its block</span>
        )}
      </div>
      {code === '' && (
        <p className="python-pane__empty">
          {linked
            ? 'Drag a block onto the canvas, or start typing here — they are the same program.'
            : 'Start typing here, or press Blocks to build this program out of blocks.'}
        </p>
      )}
      <div className="python-pane__body" ref={hostRef} data-testid="python-pane-host" />
    </div>
  )
}

/**
 * The ruled-paper line spacing the app is currently set to, in px.
 *
 * Read from the CSS custom property rather than the settings store: the store is
 * a React context this pane would otherwise have to be inside, and the property
 * is what the paper gradient itself uses — so the text lands on the lines.
 */
function ruleSpacing(): number {
  const raw = getComputedStyle(document.documentElement)
    .getPropertyValue('--editor-rule-spacing')
    .trim()
  const px = Number.parseFloat(raw)
  return Number.isFinite(px) && px > 0 ? px : 30
}

export default PythonPane
