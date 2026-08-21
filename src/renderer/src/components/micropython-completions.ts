/**
 * Dialect-aware autocomplete for the `python` language in Monaco.
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
 * ## Which Python it suggests (#763, epic #209)
 *
 * The catalogue is chosen by the session's DIALECT, via `dialect-symbols.ts`:
 * a CircuitPython board gets `board`/`digitalio`/`busio` and never `machine` or
 * `sleep_ms`; a MicroPython board gets the reverse; an unestablished dialect gets
 * both, each entry tagged with the runtime it belongs to.
 *
 * The dialect LIVES IN A MODULE-LEVEL VARIABLE rather than being baked into the
 * provider at registration, because the provider is registered exactly once for
 * the page but the answer changes the moment a board is plugged in. The React
 * side calls {@link setCompletionDialect} whenever the effective dialect changes
 * and the very next keystroke completes against the new catalogue — no
 * re-registration, no stacked providers.
 */
import type * as Monaco from 'monaco-editor/esm/vs/editor/editor.api'
import type { Dialect } from '../../../shared/dialect'
import {
  classMembersFor,
  crossDialectHints,
  detailFor,
  modulesByNameFor,
  modulesFor
} from './dialect-symbols'
import type { SymbolMember } from './micropython-symbols'

/** Marker key used to make double-registration idempotent across HMR. */
const REGISTERED_KEY = '__snakieMicropythonCompletionsRegistered'

type GuardedGlobal = typeof globalThis & {
  [REGISTERED_KEY]?: boolean
}

/**
 * The dialect the suggestions currently describe. Starts `unknown` — nothing is
 * connected when the editor first mounts, and `unknown` shows both runtimes
 * rather than guessing MicroPython.
 */
let currentDialect: Dialect = 'unknown'

/**
 * Point the completions at a runtime. Called from the React tree whenever the
 * effective dialect changes (a board connects, or the user overrides it in the
 * Help panel). Cheap and idempotent.
 */
export function setCompletionDialect(dialect: Dialect): void {
  currentDialect = dialect
}

/** The dialect the completions are currently offering. */
export function getCompletionDialect(): Dialect {
  return currentDialect
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
 * Register the dialect-aware completion provider for `python`.
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
      // Read the dialect ONCE per request, so a single popup is internally
      // consistent even if a board connects mid-keystroke.
      const dialect = currentDialect
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

      const moduleItems = (): Monaco.languages.CompletionItem[] =>
        modulesFor(dialect).map((mod) => ({
          label: mod.name,
          kind: monaco.languages.CompletionItemKind.Module,
          insertText: mod.name,
          detail: detailFor(mod.detail, mod.scope, dialect),
          documentation: mod.doc ? { value: mod.doc } : undefined,
          range
        }))

      // 1) `<obj>.<partial>` — member completions for a known module or class.
      const dotMatch = /([A-Za-z_][A-Za-z0-9_]*)\.\s*([A-Za-z0-9_]*)$/.exec(lineToCursor)
      if (dotMatch) {
        const owner = dotMatch[1]
        const members =
          modulesByNameFor(dialect)[owner]?.members ?? classMembersFor(dialect)[owner]
        if (members && members.length > 0) {
          return {
            suggestions: members.map((m) => ({
              label: m.name,
              kind: memberKind(monaco, m.kind),
              insertText: m.name,
              detail: detailFor(m.detail ?? `${owner}.${m.name}`, m.scope, dialect),
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
        // The wrong-runtime hints go FIRST (sortText '0'), because the whole
        // point is to catch `from machine import Pin` being pasted into a
        // CircuitPython project before the user runs it and reads a traceback.
        const hints: Monaco.languages.CompletionItem[] = crossDialectHints(dialect).map((h) => ({
          label: h.name,
          kind: monaco.languages.CompletionItemKind.Issue,
          insertText: h.name,
          detail: h.detail,
          documentation: { value: h.doc },
          sortText: `0${h.name}`,
          range
        }))
        return { suggestions: [...hints, ...moduleItems()] }
      }

      // 3) General identifier context — offer module names as importable
      //    references (merged with Monaco's built-in word suggestions).
      return { suggestions: moduleItems() }
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
