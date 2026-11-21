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
import {
  canonicalModule,
  loadMicropythonStubs,
  micropythonStubs,
  stubModule,
  type StubCatalogue,
  type StubMember
} from './micropython-stubs'
import {
  activeSignature,
  callContext,
  dottedOwner,
  fromImportContext,
  memberDetail,
  memberMarkdown,
  membersOf,
  memberContext,
  memberSortText,
  resolveExpr,
  scanScope,
  signaturesFor,
  type FileScope,
  type Resolved
} from './micropython-intellisense'
import { spriteCompletionContext, spriteCompletions } from './sprite-completions'
import { keywordsAt } from './python-keywords'
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

/**
 * The stub catalogue, when this session may be offered it: never to a
 * CircuitPython board (the stubs are MicroPython's API), and not until the
 * lazily-loaded data has arrived.
 */
function stubsFor(dialect: Dialect): StubCatalogue | null {
  return dialect === 'circuitpython' ? null : micropythonStubs()
}

/**
 * What the file imports and assigns, cached per model version: completion,
 * signature help and hover all ask on the same keystroke, and the scan is a
 * pass over the whole buffer.
 */
let scopeCache: { uri: string; version: number; scope: FileScope } | null = null
function fileScope(model: Monaco.editor.ITextModel): FileScope {
  const uri = model.uri.toString()
  const version = model.getVersionId()
  if (scopeCache && scopeCache.uri === uri && scopeCache.version === version) return scopeCache.scope
  const scope = scanScope(model.getValue())
  scopeCache = { uri, version, scope }
  return scope
}

/** Monaco kind for a stub member. */
function stubKind(
  monaco: typeof Monaco,
  member: StubMember,
  instance: boolean
): Monaco.languages.CompletionItemKind {
  const k = monaco.languages.CompletionItemKind
  switch (member.kind) {
    case 'class':
      return k.Class
    case 'method':
      return k.Method
    case 'function':
      return k.Function
    case 'constant':
      return k.Constant
    default:
      return instance ? k.Property : k.Variable
  }
}

/** The label a member is documented under: `machine.Pin`, `Pin.irq`. */
function ownerLabel(target: Resolved): string {
  return target.kind === 'module' ? target.module : target.path.join('.')
}

/**
 * Completion items for `<owner>.` from the stubs, plus any curated member the
 * stubs lack (on an unknown dialect that is how `time.monotonic` — a
 * CircuitPython member — still shows, tagged).
 */
function stubMemberItems(
  monaco: typeof Monaco,
  catalogue: StubCatalogue,
  target: Resolved,
  dialect: Dialect,
  range: Monaco.IRange
): Monaco.languages.CompletionItem[] {
  const instance = target.kind === 'member' && target.instance
  const owner = ownerLabel(target)
  const items: Monaco.languages.CompletionItem[] = membersOf(catalogue, target).map((entry) => ({
    label: entry.name,
    kind: stubKind(monaco, entry.member, instance),
    insertText: entry.name,
    detail: detailFor(memberDetail(entry.name, entry.member), 'micropython', dialect),
    documentation: { value: memberMarkdown(`${owner}.${entry.name}`, entry.member) },
    sortText: memberSortText(entry, memberContext(target)),
    range
  }))
  if (target.kind === 'module') {
    const seen = new Set(items.map((i) => i.label as string))
    const curated = curatedModuleMembers(target.module, dialect, catalogue)
    for (const m of curated) {
      if (seen.has(m.name)) continue
      items.push({
        label: m.name,
        kind: memberKind(monaco, m.kind),
        insertText: m.name,
        detail: detailFor(m.detail ?? `${owner}.${m.name}`, m.scope, dialect),
        documentation: m.doc ? { value: m.doc } : undefined,
        sortText: `5${m.name.toLowerCase()}`,
        range
      })
    }
  }
  return items
}

/** The curated members of a module (by its own name or a u-alias). */
function curatedModuleMembers(
  module: string,
  dialect: Dialect,
  catalogue: StubCatalogue | null
): SymbolMember[] {
  const byName = modulesByNameFor(dialect)
  const canonical = catalogue ? canonicalModule(catalogue, module) : module
  return byName[module]?.members ?? byName[canonical]?.members ?? []
}

/** Hover / details markdown for a whole module, with a link to its docs page. */
function moduleMarkdown(name: string, catalogue: StubCatalogue): string {
  const mod = catalogue.modules[name]
  if (!mod) return `\`${name}\``
  const out = ['```python', `import ${name}`, '```']
  if (mod.doc) out.push('', mod.doc)
  if (mod.ports?.length) out.push('', `*${mod.ports.join(' / ')} only.*`)
  if (mod.url) out.push('', `[MicroPython docs](${mod.url})`)
  return out.join('\n')
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

      const catalogue = stubsFor(dialect)

      const moduleItems = (includeStubs = false): Monaco.languages.CompletionItem[] => {
        const items: Monaco.languages.CompletionItem[] = modulesFor(dialect).map((mod) => ({
          label: mod.name,
          kind: monaco.languages.CompletionItemKind.Module,
          insertText: mod.name,
          detail: detailFor(mod.detail, mod.scope, dialect),
          documentation: mod.doc ? { value: mod.doc } : undefined,
          range
        }))
        if (!includeStubs || !catalogue) return items
        // After `import`, every module the stubs know — `ntptime`, `dht`,
        // `onewire`, `espnow`, the `u`-names — not just the curated favourites.
        const seen = new Set(items.map((i) => i.label as string))
        for (const [name, mod] of Object.entries(catalogue.modules)) {
          if (seen.has(name)) continue
          seen.add(name)
          const summary = (mod.doc ?? '').split('\n\n')[0].replace(/\s+/g, ' ').trim()
          const ports = mod.ports?.length ? `${mod.ports.join(' / ')} only · ` : ''
          items.push({
            label: name,
            kind: monaco.languages.CompletionItemKind.Module,
            insertText: name,
            detail: detailFor(`${ports}${summary}`, 'micropython', dialect),
            documentation: { value: moduleMarkdown(name, catalogue) },
            sortText: `1${name}`,
            range
          })
        }
        for (const [alias, target] of Object.entries(catalogue.aliases)) {
          if (seen.has(alias)) continue
          items.push({
            label: alias,
            kind: monaco.languages.CompletionItemKind.Module,
            insertText: alias,
            detail: detailFor(`Same as \`${target}\``, 'micropython', dialect),
            documentation: { value: moduleMarkdown(target, catalogue) },
            sortText: `2${alias}`,
            range
          })
        }
        return items
      }

      // 1) `from machine import |` / `from machine import Pin, |` — what the
      //    module has, not a list of modules.
      const fromCtx = fromImportContext(lineToCursor)
      if (fromCtx) {
        const items: Monaco.languages.CompletionItem[] = []
        const mod = catalogue ? stubModule(catalogue, fromCtx.module) : undefined
        if (catalogue && mod) {
          items.push(
            ...stubMemberItems(
              monaco,
              catalogue,
              { kind: 'module', module: canonicalModule(catalogue, fromCtx.module) },
              dialect,
              range
            )
          )
        } else {
          for (const m of curatedModuleMembers(fromCtx.module, dialect, catalogue)) {
            items.push({
              label: m.name,
              kind: memberKind(monaco, m.kind),
              insertText: m.name,
              detail: detailFor(m.detail ?? `${fromCtx.module}.${m.name}`, m.scope, dialect),
              documentation: m.doc ? { value: m.doc } : undefined,
              range
            })
          }
        }
        return { suggestions: items }
      }

      // 2) `<obj>.<partial>` — member completions. With the stubs this follows
      //    the file: `m.` after `import machine as m`, `led.` after
      //    `led = Pin(25, Pin.OUT)`, `self.pwm.` after `self.pwm = PWM(…)`.
      const dotted = dottedOwner(lineToCursor)
      if (dotted && catalogue) {
        const target = resolveExpr(dotted.owner, fileScope(model), catalogue)
        if (target && (target.kind === 'module' || target.member.kind === 'class')) {
          return { suggestions: stubMemberItems(monaco, catalogue, target, dialect, range) }
        }
      }
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

      // 3) After `import ` / `from ` — suggest module names. Handles
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
        return { suggestions: [...hints, ...moduleItems(true)] }
      }

      // Inside a call with nothing typed yet (`PWM(Pin(15), |`) the signature
      // help is the useful popup; a module list would sit on top of it.
      if (!word.word && callContext(lineToCursor)) return { suggestions: [] }

      // 4) General identifier context — the Python keywords valid here (Monaco
      //    has none of its own, so `fro` offered nothing), then module names as
      //    importable references (merged with Monaco's built-in word suggestions).
      const before = model.getValueInRange({
        startLineNumber: Math.max(1, position.lineNumber - 200),
        startColumn: 1,
        endLineNumber: position.lineNumber,
        endColumn: 1
      })
      const keywords = keywordsAt(before.split('\n').slice(0, -1), lineToCursor).map(
        (k): Monaco.languages.CompletionItem => ({
          label: k.keyword,
          kind: monaco.languages.CompletionItemKind.Keyword,
          insertText: k.insert,
          detail: k.detail,
          // Ahead of the module list for the same letters.
          sortText: `0${k.keyword}`,
          range
        })
      )
      // A single keyword means a spot only it can fill (`from machine |` →
      // import, `for x |` → in, `import machine |` → as): a module list there
      // is noise.
      if (keywords.length === 1) return { suggestions: keywords }
      return { suggestions: [...keywords, ...moduleItems()] }
    }
  })

  // The stub catalogue is its own chunk; start fetching it now so it is there
  // by the time anyone types a dot.
  void loadMicropythonStubs()

  const signatures = monaco.languages.registerSignatureHelpProvider('python', {
    signatureHelpTriggerCharacters: ['(', ','],
    signatureHelpRetriggerCharacters: [')'],
    provideSignatureHelp(model, position) {
      const catalogue = stubsFor(currentDialect)
      if (!catalogue) return null
      const text = model.getValueInRange({
        startLineNumber: Math.max(1, position.lineNumber - 60),
        startColumn: 1,
        endLineNumber: position.lineNumber,
        endColumn: position.column
      })
      const ctx = callContext(text)
      if (!ctx) return null
      const target = resolveExpr(ctx.callee, fileScope(model), catalogue)
      const sigs = signaturesFor(target)
      if (!target || target.kind !== 'member' || !sigs.length) return null
      const active = activeSignature(sigs, ctx)
      const prefix = target.path.slice(0, -1).join('.')
      return {
        value: {
          signatures: sigs.map((sig) => {
            const label = prefix ? `${prefix}.${sig.label}` : sig.label
            // Offsets rather than substrings: `x` is inside `max_x`.
            let from = label.indexOf('(') + 1
            const parameters = sig.params.map((p) => {
              const at = label.indexOf(p, from)
              const start = at < 0 ? from : at
              from = start + p.length
              return { label: [start, start + p.length] as [number, number] }
            })
            const doc = sig.doc ?? target.member.doc
            return { label, parameters, documentation: doc ? { value: doc } : undefined }
          }),
          activeSignature: active.signature,
          activeParameter: active.parameter
        },
        dispose: () => undefined
      }
    }
  })

  const hovers = monaco.languages.registerHoverProvider('python', {
    provideHover(model, position) {
      const catalogue = stubsFor(currentDialect)
      if (!catalogue) return null
      const word = model.getWordAtPosition(position)
      if (!word) return null
      const line = model.getLineContent(position.lineNumber)
      const head = line.slice(0, word.endColumn - 1)
      const m = /([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)$/.exec(head)
      if (!m) return null
      const scope = fileScope(model)
      // On an import line the module name may not be bound yet (`from machine
      // import …` binds only the names after `import`), so look it up directly.
      const importLine = /^\s*(?:import|from)\b/.test(line)
      const target = resolveExpr(m[1], scope, catalogue, importLine)
      if (!target) return null
      const range = {
        startLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endLineNumber: position.lineNumber,
        endColumn: word.endColumn
      }
      if (target.kind === 'module') {
        return { range, contents: [{ value: moduleMarkdown(target.module, catalogue) }] }
      }
      const qualified = `${target.module}.${target.path.join('.')}`
      return { range, contents: [{ value: memberMarkdown(qualified, target.member) }] }
    }
  })

  // Dispose + allow clean re-registration on the next HMR update so we never
  // accumulate stacked providers during development.
  if (import.meta.hot) {
    import.meta.hot.dispose(() => {
      disposable.dispose()
      signatures.dispose()
      hovers.dispose()
      g[REGISTERED_KEY] = false
    })
  }

  return {
    dispose: () => {
      disposable.dispose()
      signatures.dispose()
      hovers.dispose()
    }
  }
}
