/**
 * MicroPython-aware autocomplete for the `python` language in Monaco.
 *
 * This addresses the feedback that "import machine" and friends were never
 * suggested: we register a single completion item provider that offers
 *
 *   - module names after `import ` / `from ` (e.g. `import mach|` -> `machine`)
 *   - member completions after a module/class dot (e.g. `machine.|` -> `Pin`,
 *     `Pin.|` -> `OUT`)
 *   - the module catalogue as a general fallback while typing identifiers
 *
 * Monaco's built-in word-based Python suggestions keep working alongside this:
 * we never set `suggest.showWords` off and we return only ADDITIONAL items, so
 * both sources are merged in the completion widget.
 *
 * Registration happens exactly ONCE per renderer page. Under Vite HMR this
 * module can be re-evaluated, which would otherwise stack duplicate providers
 * (and duplicate suggestions). We guard with a flag stored on `globalThis` so
 * the guard survives module re-evaluation, and we dispose the previous provider
 * via `import.meta.hot` if HMR is active.
 */
import type * as Monaco from 'monaco-editor/esm/vs/editor/editor.api'
import { CLASS_MEMBERS, MODULES, MODULES_BY_NAME, type SymbolMember } from './micropython-symbols'

/** Marker key used to make double-registration idempotent across HMR. */
const REGISTERED_KEY = '__snakieMicropythonCompletionsRegistered'

type GuardedGlobal = typeof globalThis & {
  [REGISTERED_KEY]?: boolean
}

/** Map our symbol kinds onto Monaco completion kinds. */
function memberKind(
  monaco: typeof Monaco,
  kind: SymbolMember['kind']
): Monaco.languages.CompletionItemKind {
  const k = monaco.languages.CompletionItemKind
  switch (kind) {
    case 'class':
      return k.Class
    case 'function':
      return k.Function
    case 'constant':
      return k.Constant
    case 'variable':
      return k.Variable
    default:
      return k.Field
  }
}

/**
 * Register the MicroPython completion provider for `python`.
 *
 * Safe to call repeatedly: the first call wins, later calls are no-ops (the
 * `globalThis` guard survives HMR re-evaluation of this module). Returns the
 * provider's disposable when it registers, otherwise `undefined`.
 */
export function registerMicropythonCompletions(
  monaco: typeof Monaco
): Monaco.IDisposable | undefined {
  const g = globalThis as GuardedGlobal
  if (g[REGISTERED_KEY]) return undefined
  g[REGISTERED_KEY] = true

  const disposable = monaco.languages.registerCompletionItemProvider('python', {
    // `.` drives member completion; the rest let the widget pop up as the user
    // types an identifier without forcing a manual Ctrl-Space.
    triggerCharacters: ['.', ' ', ...'abcdefghijklmnopqrstuvwxyz'],

    provideCompletionItems(model, position) {
      const lineToCursor = model.getValueInRange({
        startLineNumber: position.lineNumber,
        startColumn: 1,
        endLineNumber: position.lineNumber,
        endColumn: position.column
      })

      // The word currently being typed, used to compute the replace range so we
      // don't duplicate already-typed characters.
      const word = model.getWordUntilPosition(position)
      const range: Monaco.IRange = {
        startLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endLineNumber: position.lineNumber,
        endColumn: word.endColumn
      }

      // 1) `<obj>.<partial>` — member completions for a known module or class.
      const dotMatch = /([A-Za-z_][A-Za-z0-9_]*)\.\s*([A-Za-z0-9_]*)$/.exec(lineToCursor)
      if (dotMatch) {
        const owner = dotMatch[1]
        const members = MODULES_BY_NAME[owner]?.members ?? CLASS_MEMBERS[owner]
        if (members && members.length > 0) {
          return {
            suggestions: members.map((m) => ({
              label: m.name,
              kind: memberKind(monaco, m.kind),
              insertText: m.name,
              detail: m.detail ?? `${owner}.${m.name}`,
              documentation: m.doc ? { value: m.doc } : undefined,
              range
            }))
          }
        }
        // Unknown owner: defer entirely to built-in word suggestions.
        return { suggestions: [] }
      }

      // 2) After `import ` / `from ` — suggest module names. Handles
      //    `import x`, `from x`, and `from x import y` (the trailing import).
      const importMatch = /(?:^|\b)(?:import|from)\s+([A-Za-z0-9_]*)$/.exec(lineToCursor)
      if (importMatch) {
        return {
          suggestions: MODULES.map((mod) => ({
            label: mod.name,
            kind: monaco.languages.CompletionItemKind.Module,
            insertText: mod.name,
            detail: mod.detail,
            documentation: mod.doc ? { value: mod.doc } : undefined,
            range
          }))
        }
      }

      // 3) General identifier context — offer module names as importable
      //    references (merged with Monaco's built-in word suggestions).
      return {
        suggestions: MODULES.map((mod) => ({
          label: mod.name,
          kind: monaco.languages.CompletionItemKind.Module,
          insertText: mod.name,
          detail: mod.detail,
          documentation: mod.doc ? { value: mod.doc } : undefined,
          range
        }))
      }
    }
  })

  // Dispose + allow clean re-registration on the next HMR update so we never
  // accumulate stacked providers during development.
  if (import.meta.hot) {
    import.meta.hot.dispose(() => {
      disposable.dispose()
      g[REGISTERED_KEY] = false
    })
  }

  return disposable
}
