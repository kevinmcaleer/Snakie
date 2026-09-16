import * as monaco from 'monaco-editor/esm/vs/editor/editor.api'
import 'monaco-editor/esm/vs/editor/editor.all'
import 'monaco-editor/esm/vs/basic-languages/python/python.contribution'
// Wires Monaco's worker to the bundled copy AND registers the MicroPython
// completion provider — the same one the editor uses. Importing it is the whole
// of "reuse `micropython-completions.ts`": the provider is global to the
// `python` language, so an instance opened here gets `machine.`, `Pin.OUT`, the
// module catalogue and the dialect filtering with nothing more to do.
import '../../components/monaco-setup'
import {
  ensureMonacoThemes,
  monacoTheme,
  readDocTheme,
  readEditorTheme
} from '../../components/monaco-theme'
import { setCodeEditorFactory, type CodeEditorHandle } from './python-field'
import './python-field.css'

/**
 * MONACO INSIDE A BLOCK (#1018, epic #1007).
 * =============================================================================
 *
 * The issue's actual ask: that the escape hatch be **the best-autocompleted
 * field in the app rather than the worst**. So clicking a Python block's text
 * opens a real one-line code editor — Python syntax highlighting, bracket
 * matching, and the app's own MicroPython completions, filtered by the connected
 * board's dialect. Typing `machine.` in the grey block offers the same list as
 * typing it in the editor next door, because it IS the same list.
 *
 * WHY A SEPARATE MODULE. `python-field.ts` holds the field and must stay
 * importable in plain node — the generator's golden-file suites build a headless
 * workspace out of the whole palette, and Monaco touches `window` at module
 * scope. So the editor arrives through a factory, installed by importing THIS
 * file, which only the canvas does.
 *
 * WHY THAT IS AFFORDABLE. The Blocks workspace already downloads Monaco: the
 * Python mirror (#1010) is a Monaco instance and is on screen in every view
 * mode. Rollup puts it in one shared chunk, so this costs a reference rather
 * than a download.
 *
 * AN EDITOR PER OPEN, disposed on close. A shared instance would be cheaper to
 * create and much worse to own: it would have to be detached from one widget div
 * and re-parented into the next, taking its focus, its view state and its undo
 * history with it. Creating one costs a few milliseconds, on a click.
 */
setCodeEditorFactory(({ host, value, onCommit, onCancel }): CodeEditorHandle | null => {
  ensureMonacoThemes()
  const skin = readDocTheme()
  const editor = monaco.editor.create(host, {
    value,
    language: 'python',
    theme: monacoTheme(skin, readEditorTheme()),
    automaticLayout: true,
    // ONE LINE. A raw-Python block holds one statement (see `palette/python.ts`),
    // so everything that implies a document — line numbers, folding, the
    // minimap, the current-line highlight — is noise around a single line.
    lineNumbers: 'off',
    glyphMargin: false,
    folding: false,
    minimap: { enabled: false },
    lineDecorationsWidth: 0,
    lineNumbersMinChars: 0,
    renderLineHighlight: 'none',
    overviewRulerLanes: 0,
    hideCursorInOverviewRuler: true,
    scrollbar: { vertical: 'hidden', horizontal: 'auto', horizontalScrollbarSize: 6 },
    scrollBeyondLastLine: false,
    wordWrap: 'off',
    contextmenu: false,
    fontSize: 13,
    // The suggestion popup has to escape the widget div, which Blockly sizes to
    // its contents and clips.
    fixedOverflowWidgets: true,
    // Open the suggestions as soon as there is something to suggest: this is a
    // small box in a block palette, and a learner here has no reason to know
    // that Ctrl-Space is a thing.
    quickSuggestions: { other: true, comments: false, strings: true },
    suggestOnTriggerCharacters: true,
    tabCompletion: 'on',
    acceptSuggestionOnEnter: 'on'
  })

  // A newline in a one-line field would silently become a line the block cannot
  // show. Enter COMMITS instead — unless the suggest widget is open, where Enter
  // means "take this suggestion" and Monaco handles it first.
  editor.addCommand(monaco.KeyCode.Enter, onCommit, '!suggestWidgetVisible')
  editor.addCommand(monaco.KeyCode.Escape, onCancel, '!suggestWidgetVisible')
  editor.setPosition({ lineNumber: 1, column: value.length + 1 })

  return {
    getValue: () => editor.getValue(),
    focus: () => editor.focus(),
    // `dispose()` ALONE. A standalone editor created from `value`+`language`
    // owns the model it made and disposes it itself; disposing the model first
    // leaves Monaco's own teardown reading a model that is already gone, which
    // throws `Model is disposed!` out of Blockly's widget-div close path.
    dispose: () => editor.dispose()
  }
})
