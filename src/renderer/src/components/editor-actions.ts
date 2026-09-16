import * as monaco from 'monaco-editor/esm/vs/editor/editor.api'
import { dispatchOpenHelp } from './editorBridge'
import { resolveHelpTarget } from './context-help'
import { tidyFile } from './refactor-code-actions'
import type { Dialect } from '../../../shared/dialect'

/**
 * THE RIGHT-CLICK MENU, IN ONE PLACE.
 * =============================================================================
 *
 * Extracted from `MonacoEditor.tsx` for the same reason `monaco-theme.ts` was:
 * the blocks split mounts a SECOND Monaco — the Python pane beside the canvas —
 * and two copies of a thing agree on the day they are written.
 *
 * Only this time it was not a drift, it was an absence. `PythonPane` was written
 * after these actions, never carried them over, and since #1034 made the pane
 * EDITABLE and #1008 made a `.py` with a blocks footer open in the split even
 * from the Code workspace, that pane is where a learner does their typing. So
 * right-clicking a variable or a class in a blocks file offered Monaco's bare
 * default menu: no **Help for symbol**, no **Refactor…**, no **Tidy this file**,
 * on the editor those three were written for.
 *
 * The actions are identical in both, which is the point — the pane is not a
 * preview of the editor, it IS the editor for that file.
 */

/**
 * Add Snakie's context-menu actions to `editor`.
 *
 * `dialect` is read as a FUNCTION, not a value: the help dialect changes when a
 * board is plugged in, and an action registered once at mount would otherwise
 * answer with whatever was true when the editor was created. The caller keeps
 * it in a ref and hands the getter in.
 *
 * Returns the disposables, so the caller tears them down with the editor.
 */
export function installEditorActions(
  editor: monaco.editor.IStandaloneCodeEditor,
  dialect: () => Dialect
): monaco.IDisposable[] {
  return [
    // Right-click context help (#221): "Help for <symbol>" in the editor's
    // context menu. Resolves the word under the cursor to an installed library
    // part's bundled help (bme280, servo, …) or a language-reference topic
    // (Pin/PWM/I2C/sleep/…), and opens the mini help at that page. Unknown words
    // open nothing (the resolver is the single source of what's helpable).
    editor.addAction({
      id: 'snakie.contextHelp',
      label: 'Help for symbol (Snakie)',
      contextMenuGroupId: 'navigation',
      contextMenuOrder: 1.1,
      run: async (ed) => {
        const pos = ed.getPosition()
        const word = pos ? ed.getModel()?.getWordAtPosition(pos)?.word : undefined
        if (!word) return
        const libs = await window.api.parts.listLibraries().catch(() => [])
        // Dialect-aware (#763): `I2C` means different pages on the two runtimes,
        // and a MicroPython name on a CircuitPython board resolves to the page
        // that says what to write instead.
        const target = resolveHelpTarget(word, libs, dialect())
        if (target) dispatchOpenHelp(target.articleId)
      }
    }),

    // Right-click Refactor… (#634): opens Monaco's code-action picker filtered
    // to `refactor.*`, listing what the shared engine offers for the selection.
    // Every entry previews its diff before it touches the file, and a file that
    // doesn't parse offers nothing at all.
    editor.addAction({
      id: 'snakie.refactor',
      label: 'Refactor… (Snakie)',
      contextMenuGroupId: 'navigation',
      contextMenuOrder: 1.2,
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyR],
      precondition: 'editorLangId == python',
      run: (ed) => {
        void ed.getAction('editor.action.refactor')?.run()
      }
    }),

    // Tidy this file (#634 R7): apply every provably-safe refactoring at once,
    // as one preview and one undo step. Kept off the speed/RAM trade-off rules.
    editor.addAction({
      id: 'snakie.refactor.tidyFile',
      label: 'Tidy this file (Snakie)',
      contextMenuGroupId: 'navigation',
      contextMenuOrder: 1.3,
      precondition: 'editorLangId == python',
      run: () => tidyFile(monaco)
    })
  ]
}
