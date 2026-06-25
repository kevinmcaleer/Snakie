import type * as monaco from 'monaco-editor/esm/vs/editor/editor.api'
import { getActiveEditor } from './editorBridge'

/**
 * Find & Replace controller (issue #146).
 *
 * The Find & Replace UI now lives in its OWN native OS window (a separate
 * renderer process — see `find-main.tsx` / `src/main/find.ts`), which cannot
 * touch the Monaco editor: the editor instance is a module-level singleton local
 * to the MAIN window's renderer (`editorBridge`). So the find window sends
 * {@link FindCommand}s over IPC and THIS module — run in the main window — drives
 * Monaco and replies with a {@link FindStatus}.
 *
 * Extracted from the old in-editor `FindReplace` panel; same `findMatches` /
 * `setSelection` / `executeEdits` mechanics, minus the regex option (removed in
 * #146) and minus the focus hand-off (focus must stay in the find window).
 */

/** What the find window is asking the editor to do. */
export type FindAction = 'count' | 'next' | 'prev' | 'replace' | 'replaceFind' | 'replaceAll'

/** A find/replace request from the find window. */
export interface FindCommand {
  action: FindAction
  query: string
  replacement: string
  matchCase: boolean
  wholeWord: boolean
}

/** The result pushed back to the find window for its `N of M matches` line. */
export interface FindStatus {
  /** 1-based index of the current selection among the matches, or 0 if none. */
  matchIndex: number
  /** Total matches for the query in the active model. */
  matchCount: number
}

/**
 * Monaco's default word separators (the value its find widget uses for
 * whole-word matching). Passed as `wordSeparators` to `findMatches` when the
 * whole-word toggle is on; `null` otherwise.
 */
const USUAL_WORD_SEPARATORS = '`~!@#$%^&*()-=+[{]}\\|;:\'",.<>/?'

/** A Monaco range, compared field-by-field (no reference identity available). */
function rangesEqual(a: monaco.IRange, b: monaco.IRange): boolean {
  return (
    a.startLineNumber === b.startLineNumber &&
    a.startColumn === b.startColumn &&
    a.endLineNumber === b.endLineNumber &&
    a.endColumn === b.endColumn
  )
}

/** All matches for the command's query/options in the active model (empty if none). */
function allMatches(cmd: FindCommand): monaco.editor.FindMatch[] {
  const editor = getActiveEditor()
  const model = editor?.getModel()
  if (!editor || !model || cmd.query.length === 0) return []
  // findMatches(searchString, searchOnlyEditableRange, isRegex, matchCase,
  //   wordSeparators, captureMatches). Regex is always false (#146 dropped it).
  return model.findMatches(
    cmd.query,
    false,
    false,
    cmd.matchCase,
    cmd.wholeWord ? USUAL_WORD_SEPARATORS : null,
    false
  )
}

/** Index (1-based) of the current selection among `matches`, or 0 if none. */
function indexOfSelection(matches: monaco.editor.FindMatch[]): number {
  const selection = getActiveEditor()?.getSelection()
  if (!selection) return 0
  const i = matches.findIndex((m) => rangesEqual(m.range, selection))
  return i < 0 ? 0 : i + 1
}

/**
 * Select the next match in `dir` relative to the current selection, wrapping.
 * Does NOT focus the editor — focus must stay in the find window.
 */
function findNext(dir: 'up' | 'down', matches: monaco.editor.FindMatch[]): void {
  const editor = getActiveEditor()
  if (!editor || matches.length === 0) return

  const selection = editor.getSelection()
  let target: monaco.editor.FindMatch
  if (!selection) {
    target = dir === 'down' ? matches[0] : matches[matches.length - 1]
  } else if (dir === 'down') {
    target =
      matches.find(
        (m) =>
          m.range.startLineNumber > selection.startLineNumber ||
          (m.range.startLineNumber === selection.startLineNumber &&
            m.range.startColumn > selection.startColumn)
      ) ?? matches[0]
  } else {
    const prior = matches.filter(
      (m) =>
        m.range.startLineNumber < selection.startLineNumber ||
        (m.range.startLineNumber === selection.startLineNumber &&
          m.range.startColumn < selection.startColumn)
    )
    target = prior.length > 0 ? prior[prior.length - 1] : matches[matches.length - 1]
  }

  editor.setSelection(target.range)
  editor.revealRangeInCenterIfOutsideViewport(target.range)
}

/**
 * If the current selection exactly matches a found range, replace it in place
 * (through the editor so the workspace store updates) and return true.
 */
function replaceCurrent(cmd: FindCommand): boolean {
  const editor = getActiveEditor()
  const selection = editor?.getSelection()
  if (!editor || !selection) return false
  const hit = allMatches(cmd).find((m) => rangesEqual(m.range, selection))
  if (!hit) return false
  editor.executeEdits('snakie-find-replace', [
    { range: hit.range, text: cmd.replacement, forceMoveMarkers: true }
  ])
  return true
}

/** Replace every match in a single edit (one undo stop). */
function replaceAll(cmd: FindCommand): void {
  const editor = getActiveEditor()
  if (!editor) return
  const matches = allMatches(cmd)
  if (matches.length === 0) return
  editor.executeEdits(
    'snakie-find-replace-all',
    matches.map((m) => ({ range: m.range, text: cmd.replacement, forceMoveMarkers: true }))
  )
}

/**
 * Run a find/replace command against the active editor and return the resulting
 * status. Called in the MAIN window from the `find:command` IPC handler.
 */
export function runFindCommand(cmd: FindCommand): FindStatus {
  switch (cmd.action) {
    case 'next':
      findNext('down', allMatches(cmd))
      break
    case 'prev':
      findNext('up', allMatches(cmd))
      break
    case 'replace':
      // Replace the current match if the selection is on one; else find first so
      // a subsequent Replace lands on a match.
      if (!replaceCurrent(cmd)) findNext('down', allMatches(cmd))
      break
    case 'replaceFind':
      replaceCurrent(cmd)
      findNext('down', allMatches(cmd))
      break
    case 'replaceAll':
      replaceAll(cmd)
      break
    case 'count':
    default:
      break
  }
  // Recompute against the (possibly mutated) model for an accurate status.
  const after = allMatches(cmd)
  return { matchCount: after.length, matchIndex: indexOfSelection(after) }
}
