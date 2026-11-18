/**
 * Go to Definition for the user's own Python (variables, functions, classes,
 * imports, loop variables, `self.x` attributes).
 *
 * One definition provider gives Monaco everything it needs for the standard
 * gestures — right-click "Go to Definition" / "Peek Definition", F12, and
 * Cmd/Ctrl+click (with the underline on hover while the key is held). A hover
 * provider adds "defined on line 34" with the line's code and a link that
 * jumps there, so the definition is discoverable without knowing the gestures.
 *
 * Unlike the stub-driven completions this is dialect-independent: it only
 * reads the file in the editor.
 */
import type * as Monaco from 'monaco-editor/esm/vs/editor/editor.api'
import { codeOnly, definitionOf, findDefinitions, type Definition } from './python-definitions'

const REGISTERED_KEY = '__snakiePythonNavigationRegistered'
type GuardedGlobal = typeof globalThis & { [REGISTERED_KEY]?: boolean }

/** The command a hover link runs: `snakie.goToLine(uri, line, column)`. */
export const GO_TO_LINE_COMMAND = 'snakie.goToLine'

/** Definitions per model version: hover and go-to both ask on the same gesture. */
let cache: { uri: string; version: number; defs: Definition[] } | null = null
function definitionsFor(model: Monaco.editor.ITextModel): Definition[] {
  const uri = model.uri.toString()
  const version = model.getVersionId()
  if (cache && cache.uri === uri && cache.version === version) return cache.defs
  const defs = findDefinitions(model.getValue())
  cache = { uri, version, defs }
  return defs
}

/**
 * The definition of the identifier under the cursor, or null. Member access on
 * anything but `self` (`machine.Pin`, `led.on`) is not the file's own name, so
 * it is left to the stub hover; so is a word inside a string or comment.
 */
export function lookup(
  model: Monaco.editor.ITextModel,
  position: Monaco.Position
): { def: Definition; word: Monaco.editor.IWordAtPosition } | null {
  const word = model.getWordAtPosition(position)
  if (!word || !/^[A-Za-z_]/.test(word.word)) return null
  const line = model.getLineContent(position.lineNumber)
  const code = codeOnly(line)
  if (code[word.startColumn - 1] !== line[word.startColumn - 1]) return null
  const before = line.slice(0, word.startColumn - 1)
  const attribute = /\bself\.\s*$/.test(before)
  if (!attribute && /\.\s*$/.test(before)) return null
  const def = definitionOf(
    model.getValue(),
    word.word,
    position.lineNumber,
    attribute,
    definitionsFor(model)
  )
  return def ? { def, word } : null
}

const KIND_LABEL: Record<Definition['kind'], string> = {
  variable: 'variable',
  function: 'function',
  class: 'class',
  parameter: 'parameter',
  import: 'import',
  loop: 'loop variable',
  attribute: 'attribute'
}

/** Register the definition + hover providers and the jump command. Idempotent. */
export function registerPythonNavigation(monaco: typeof Monaco): Monaco.IDisposable | undefined {
  const g = globalThis as GuardedGlobal
  if (g[REGISTERED_KEY]) return undefined
  g[REGISTERED_KEY] = true

  const command = monaco.editor.registerCommand(
    GO_TO_LINE_COMMAND,
    (_accessor, uri: string, line: number, column: number) => {
      const editor = monaco.editor
        .getEditors()
        .find((e) => e.getModel()?.uri.toString() === uri)
      if (!editor) return
      editor.setPosition({ lineNumber: line, column })
      editor.revealLineInCenterIfOutsideViewport(line)
      editor.focus()
    }
  )

  const definitions = monaco.languages.registerDefinitionProvider('python', {
    provideDefinition(model, position) {
      const hit = lookup(model, position)
      if (!hit) return null
      const { def } = hit
      return {
        uri: model.uri,
        range: {
          startLineNumber: def.line,
          startColumn: def.column,
          endLineNumber: def.line,
          endColumn: def.column + def.name.length
        }
      }
    }
  })

  const hovers = monaco.languages.registerHoverProvider('python', {
    provideHover(model, position) {
      const hit = lookup(model, position)
      if (!hit) return null
      const { def, word } = hit
      // Hovering the definition itself: nothing to point at.
      if (def.line === position.lineNumber && def.column === word.startColumn) return null
      const args = encodeURIComponent(JSON.stringify([model.uri.toString(), def.line, def.column]))
      const mac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
      const value = [
        `**\`${def.name}\`** · ${KIND_LABEL[def.kind]} defined on line ${def.line}`,
        '```python',
        def.text,
        '```',
        `[Go to line ${def.line}](command:${GO_TO_LINE_COMMAND}?${args}) · or ${mac ? '⌘' : 'Ctrl'}+click the name`
      ].join('\n')
      return {
        range: {
          startLineNumber: position.lineNumber,
          startColumn: word.startColumn,
          endLineNumber: position.lineNumber,
          endColumn: word.endColumn
        },
        contents: [{ value, isTrusted: { enabledCommands: [GO_TO_LINE_COMMAND] } }]
      }
    }
  })

  const disposable = {
    dispose: () => {
      command.dispose()
      definitions.dispose()
      hovers.dispose()
    }
  }
  if (import.meta.hot) {
    import.meta.hot.dispose(() => {
      disposable.dispose()
      g[REGISTERED_KEY] = false
    })
  }
  return disposable
}
