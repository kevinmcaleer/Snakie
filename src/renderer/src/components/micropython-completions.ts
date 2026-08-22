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
 *
 * ## Sprite names inside a string (#791, epic #789)
 *
 * The project's `.spr` files are offered inside a string literal, through the
 * SAME provider and the same module-level-state shape: `MonacoEditor` installs a
 * {@link SpriteCompletionSource} with {@link setSpriteCompletionSource} and the
 * next keystroke completes against it. A second registration would stack two
 * providers over one language — the hazard called out when the dialect switch
 * landed — for a branch that is a handful of lines here.
 *
 * The branch runs FIRST, and returns exclusively: inside `"eyes.spr"` a module
 * catalogue is noise, and `eyes.spr` would otherwise be read as `eyes` DOT `spr`
 * by the member branch below. When no source is installed (the browser build,
 * or before the editor mounts) the branch is skipped entirely and this provider
 * behaves exactly as it did before.
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
import { spriteCompletionContext, spriteCompletions } from './sprite-completions'
import type { SpriteRefScope } from './sprite-refs'

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

/**
 * Where the sprite branch gets its answers (#791). Every method is cheap and
 * SYNCHRONOUS — a completion request must not wait on the filesystem — except
 * {@link SpriteCompletionSource.touch}, which is a fire-and-forget nudge asking
 * the source to re-check the project in the background if its snapshot has
 * gone stale.
 */
export interface SpriteCompletionSource {
  /** The `.spr` files known right now. Empty means: offer nothing. */
  paths: () => readonly string[]
  /** Where a relative name would be looked for — the file's folder, then the root. */
  scope: () => SpriteRefScope
  /** `12×8 · 3 frames` for a sprite already read; undefined while unknown. */
  describe?: (path: string) => string | undefined
  /** Nudge the source to re-check the project. Must not block. */
  touch?: () => void
}

/**
 * The sprite source, or null. Module-level for the same reason the dialect is:
 * the provider registers once, but the project's files (and which folder a name
 * resolves against) change while it is running.
 */
let spriteSource: SpriteCompletionSource | null = null

/** Install (or, with null, remove) the source the sprite branch reads. */
export function setSpriteCompletionSource(source: SpriteCompletionSource | null): void {
  spriteSource = source
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
 * The project's sprites, as Monaco items — or null when the cursor is NOT
 * somewhere a sprite name belongs, which tells the caller to carry on with the
 * ordinary code completions.
 *
 * An empty array is a different answer: the cursor IS inside a string, and the
 * project has no `.spr` files, so this offers nothing rather than an empty popup.
 *
 * ## What it costs to type
 *
 * Lowercase letters are trigger characters, so this runs on nearly every
 * keystroke. Two things keep that honest. A single-quoted Python literal cannot
 * cross a line break, so a cursor with NO quote before it on its own line cannot
 * be inside one — that check is a scan of the current line, and it is where
 * ordinary typing exits. Only past it is the text before the cursor read (never
 * the whole buffer, and never the disk): the file list is a snapshot the source
 * already holds, and the sizes come from records #790's cache already built.
 */
function spriteSuggestions(
  monaco: typeof Monaco,
  model: Monaco.editor.ITextModel,
  position: Monaco.Position,
  source: SpriteCompletionSource
): Monaco.languages.CompletionItem[] | null {
  const line = model.getLineContent(position.lineNumber)
  const head = line.slice(0, position.column - 1)
  if (!head.includes('"') && !head.includes("'")) return null

  const prefix = model.getValueInRange({
    startLineNumber: 1,
    startColumn: 1,
    endLineNumber: position.lineNumber,
    endColumn: position.column
  })
  const context = spriteCompletionContext(prefix, line.slice(position.column - 1))
  if (!context) return null

  // We are in a sprite-shaped place: ask the source to re-check the project in
  // the background (it TTLs the walk itself), and answer from what it has now.
  source.touch?.()
  const paths = source.paths()
  if (!paths.length) return []

  // The whole literal body is replaced, not the "word" under the cursor: Monaco
  // breaks `sprites/eyes.spr` into three words, and replacing one of them would
  // leave the rest of the path behind. The insert range stops at the cursor so
  // the widget still filters on what has been typed.
  const start = model.getPositionAt(context.bodyStart)
  const insert: Monaco.IRange = {
    startLineNumber: start.lineNumber,
    startColumn: start.column,
    endLineNumber: position.lineNumber,
    endColumn: position.column
  }
  const replace: Monaco.IRange = { ...insert, endColumn: position.column + context.tailLength }
  // A literal Monaco did not auto-close gets its closing quote from us, so
  // accepting a completion never leaves the line unterminated.
  const suffix = context.closed ? '' : context.quote

  return spriteCompletions({ paths, scope: source.scope(), describe: source.describe }).map(
    (item) => ({
      label: item.text,
      kind: monaco.languages.CompletionItemKind.File,
      insertText: item.text + suffix,
      filterText: item.text,
      sortText: item.sortText,
      // `12×8 · 3 frames` — enough to pick the right sprite without opening it.
      detail: item.detail,
      documentation: { value: `\`${item.path}\`` },
      range: { insert, replace }
    })
  )
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
    // types an identifier without forcing a manual Ctrl-Space. The quotes and
    // `/` are for sprite names (#791): typing the opening quote is what makes
    // the project's artwork discoverable, and `/` continues a path.
    triggerCharacters: ['.', ' ', '"', "'", '/', ...'abcdefghijklmnopqrstuvwxyz'],

    provideCompletionItems(model, position) {
      // 0) Inside a string literal — the project's `.spr` files (#791). First,
      //    and exclusive: `"eyes.spr"` must not be read as `eyes` DOT `spr` by
      //    the member branch below, and a module catalogue inside a string is
      //    noise. Null means "not a sprite place", so the rest still runs.
      if (spriteSource) {
        const sprites = spriteSuggestions(monaco, model, position, spriteSource)
        if (sprites) return { suggestions: sprites }
      }

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
