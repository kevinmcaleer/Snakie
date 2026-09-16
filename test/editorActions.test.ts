// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { installEditorActions } from '../src/renderer/src/components/editor-actions'

/**
 * THE RIGHT-CLICK MENU IS THE SAME IN BOTH EDITORS (#221, #634).
 * =============================================================================
 *
 * The blocks split mounts a SECOND Monaco — the Python pane beside the canvas.
 * It was written after these actions and never carried them over, and since
 * #1034 made that pane editable and #1008 made a `.py` with a blocks footer open
 * in the split even from the Code workspace, that pane is where a learner types.
 * So right-clicking a variable or a class in a blocks file offered Monaco's bare
 * default menu — no Help for symbol, no Refactor…, no Tidy this file — on the
 * editor those three were written for.
 *
 * `jsdom` here and nowhere else in this suite: `editor-actions.ts` imports
 * Monaco for its keybinding enums, and Monaco reads `window` at module load.
 * The alternative was not testing the thing that actually broke.
 */
describe('installEditorActions', () => {
  /** Enough of a Monaco editor to record what gets registered on it. */
  function recorder(): {
    editor: Parameters<typeof installEditorActions>[0]
    added: { id: string; label: string; contextMenuGroupId?: string }[]
  } {
    const added: { id: string; label: string; contextMenuGroupId?: string }[] = []
    const editor = {
      addAction: (a: { id: string; label: string; contextMenuGroupId?: string }) => {
        added.push(a)
        return { dispose: () => undefined }
      }
    }
    return { editor: editor as unknown as Parameters<typeof installEditorActions>[0], added }
  }

  it('registers help, refactor and tidy', () => {
    const { editor, added } = recorder()
    installEditorActions(editor, () => 'micropython')
    expect(added.map((a) => a.id)).toEqual([
      'snakie.contextHelp',
      'snakie.refactor',
      'snakie.refactor.tidyFile'
    ])
  })

  it('puts every one of them in the CONTEXT menu', () => {
    // An action with no `contextMenuGroupId` is reachable only from the command
    // palette, which is not the gesture any of these were written for.
    const { editor, added } = recorder()
    installEditorActions(editor, () => 'micropython')
    for (const action of added) expect(action.contextMenuGroupId).toBe('navigation')
  })

  it('hands back one disposable per action, so a pane tears its own down', () => {
    const { editor, added } = recorder()
    expect(installEditorActions(editor, () => 'micropython')).toHaveLength(added.length)
  })

  it('is installed by BOTH editors — the regression this file exists for', () => {
    // Asserted against the source because the alternative is mounting two real
    // Monaco editors, and the thing that broke was not behaviour inside either
    // of them: it was one of them never calling this at all.
    for (const file of [
      'src/renderer/src/components/MonacoEditor.tsx',
      'src/renderer/src/components/PythonPane.tsx'
    ]) {
      expect({ file, installs: readFileSync(file, 'utf8').includes('installEditorActions(') })
        .toEqual({ file, installs: true })
    }
  })
})
