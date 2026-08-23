/**
 * Right-click → Refactor… (epic #634 §2.4, phase R0 / #799).
 *
 * Registers ONE Monaco `CodeActionProvider` for `python` that turns the shared
 * engine's offers into `refactor.*` code actions, plus the command that runs
 * one. Mirrors `plugin-code-actions.ts` / `format-code-actions.ts`: a per-model
 * cache, a single registration guarded against HMR double-registration.
 *
 * Two things are deliberately different from those two providers:
 *
 * 1. **The action carries a `command`, not an `edit`.** Every refactoring shows
 *    its diff first (unless the user ticked "don't ask again" for that rule), so
 *    picking one opens the preview rather than silently rewriting the file.
 * 2. **The rewrite is applied in one `pushUndoStop` bracket**, so a single
 *    Cmd+Z reverts the whole refactoring rather than one edit at a time — the
 *    epic's third acceptance criterion.
 *
 * Parsing is cached on the model's version id, because `provideCodeActions`
 * runs on every cursor move and a full parse per keystroke would be wasteful.
 */
import type * as Monaco from 'monaco-editor/esm/vs/editor/editor.api'
import {
  applyOffers,
  applyOffer,
  createContext,
  detectAll,
  offersFor
} from '../../../shared/refactor/engine'
import { ALL_RULES, safeRules } from '../../../shared/refactor/rules'
import type { RefactorContext, RefactorOffer } from '../../../shared/refactor/types'
import type { TextEdit } from '../../../shared/refactor/text'
import { getCachedCapabilities } from '../lib/board-capabilities'
import { dispatchRefactorPreview, isPreviewSuppressed } from './refactor-bus'

/** Command id the code actions invoke. */
const APPLY_COMMAND = 'snakie.refactor.apply'
/** Command id for the "Tidy this file" bulk action (R7). */
export const TIDY_COMMAND = 'snakie.refactor.tidy'

/** Marker key making double-registration idempotent across HMR. */
const REGISTERED_KEY = '__snakieRefactorCodeActionsRegistered'

type GuardedGlobal = typeof globalThis & { [REGISTERED_KEY]?: boolean }

type Model = Monaco.editor.ITextModel

/** Parsed contexts, keyed by model URI, invalidated on the model's version id. */
const contextCache = new Map<string, { version: number; ctx: RefactorContext | null }>()

/**
 * The refactoring context for a model, or null when the file does not parse.
 * Cached per model version so repeated lightbulb queries cost one parse.
 */
export function contextForModel(model: Model): RefactorContext | null {
  const uri = model.uri.toString()
  const version = model.getVersionId()
  const hit = contextCache.get(uri)
  if (hit && hit.version === version) return hit.ctx
  const ctx = createContext(model.getValue(), {
    capabilities: getCachedCapabilities(),
    fileName: model.uri.path.split('/').pop()
  })
  contextCache.set(uri, { version, ctx })
  return ctx
}

/** Forget a model's parse (e.g. when its file is closed). */
export function clearRefactorCache(uri: string): void {
  contextCache.delete(uri)
}

/** Convert engine offsets into a Monaco range on `model`. */
function toRange(model: Model, start: number, end: number): Monaco.IRange {
  const s = model.getPositionAt(start)
  const e = model.getPositionAt(end)
  return {
    startLineNumber: s.lineNumber,
    startColumn: s.column,
    endLineNumber: e.lineNumber,
    endColumn: e.column
  }
}

/**
 * Commit edits to the model as ONE undo step.
 *
 * `pushStackElement` either side of `executeEdits` is what makes Cmd+Z revert
 * the entire refactoring; without it Monaco would coalesce (or not) at its own
 * discretion and a two-edit rewrite could half-undo.
 */
function commitEdits(
  editor: Monaco.editor.IStandaloneCodeEditor,
  model: Model,
  edits: readonly TextEdit[]
): void {
  const operations = edits.map((e) => ({
    range: toRange(model, e.start, e.end),
    text: e.newText,
    forceMoveMarkers: true
  }))
  model.pushStackElement()
  editor.executeEdits('snakie.refactor', operations)
  model.pushStackElement()
}

/** The offer matching a rule id and range, recomputed against current text. */
function findOffer(ctx: RefactorContext, ruleId: string, start: number, end: number): RefactorOffer | null {
  const rule = ALL_RULES.find((r) => r.id === ruleId)
  if (!rule) return null
  const offers = detectAll(ctx, [rule])
  return (
    offers.find((o) => o.match.start === start && o.match.end === end) ??
    offers.find((o) => o.match.start <= end && start <= o.match.end) ??
    null
  )
}

/** Payload the code action hands to the apply command. */
interface ApplyArgs {
  uri: string
  ruleId: string
  start: number
  end: number
}

/**
 * Run one refactoring: recompute it against the CURRENT buffer (the model may
 * have changed since the lightbulb appeared), then either preview it or, when
 * the user has opted out of previews for this rule, apply it straight away.
 */
function runRefactor(monaco: typeof Monaco, args: ApplyArgs): void {
  const model = monaco.editor.getModel(monaco.Uri.parse(args.uri))
  if (!model) return
  const editor = monaco.editor
    .getEditors()
    .find((e) => e.getModel() === model) as Monaco.editor.IStandaloneCodeEditor | undefined
  if (!editor) return

  const ctx = contextForModel(model)
  if (!ctx) return
  const offer = findOffer(ctx, args.ruleId, args.start, args.end)
  if (!offer) return
  const applied = applyOffer(offer, ctx)
  if (!applied) return

  const commit = (): void => commitEdits(editor, model, applied.edits)

  if (isPreviewSuppressed(offer.rule.id)) {
    commit()
    return
  }
  dispatchRefactorPreview({
    ruleId: offer.rule.id,
    title: offer.match.title ?? offer.rule.title,
    message: offer.match.message ?? offer.rule.message,
    helpArticle: offer.rule.helpArticle,
    before: ctx.src,
    after: applied.result,
    safe: offer.rule.safe,
    editCount: applied.edits.length,
    onApply: commit
  })
}

/**
 * "Tidy this file" (R7): apply every provably-safe rule that fires, as one
 * preview and one undo step. Deliberately restricted to `safe` rules — the
 * speed/RAM trade-offs in §3.7 are never applied in bulk.
 */
export function tidyFile(monaco: typeof Monaco): void {
  const editor = monaco.editor.getEditors()[0] as Monaco.editor.IStandaloneCodeEditor | undefined
  const model = editor?.getModel()
  if (!editor || !model) return
  const ctx = contextForModel(model)
  if (!ctx) return
  const offers = detectAll(ctx, safeRules())
  if (offers.length === 0) return
  const applied = applyOffers(offers, ctx)
  if (!applied) return
  dispatchRefactorPreview({
    ruleId: 'tidy-file',
    title: 'Tidy this file',
    message: `${offers.length} safe ${offers.length === 1 ? 'refactoring' : 'refactorings'} in this file`,
    helpArticle: 'refactor-tidy-file',
    before: ctx.src,
    after: applied.result,
    safe: true,
    editCount: applied.edits.length,
    onApply: () => commitEdits(editor, model, applied.edits)
  })
}

/**
 * Register the refactoring code-action provider and its commands for `python`.
 * Idempotent: the first call wins, later calls (e.g. an HMR re-eval) are no-ops.
 */
export function registerRefactorCodeActions(monaco: typeof Monaco): Monaco.IDisposable | undefined {
  const g = globalThis as GuardedGlobal
  if (g[REGISTERED_KEY]) return undefined
  g[REGISTERED_KEY] = true

  const applyCommand = monaco.editor.registerCommand(APPLY_COMMAND, (_accessor, args: ApplyArgs) => {
    runRefactor(monaco, args)
  })
  const tidyCommand = monaco.editor.registerCommand(TIDY_COMMAND, () => tidyFile(monaco))

  const provider = monaco.languages.registerCodeActionProvider(
    'python',
    {
      provideCodeActions(model, range) {
        const ctx = contextForModel(model)
        // A file that does not parse gets no refactorings at all (§2.6.1) —
        // the acceptance criterion "offers nothing when the file doesn't parse".
        if (!ctx) return { actions: [], dispose: () => {} }

        const start = model.getOffsetAt({
          lineNumber: range.startLineNumber,
          column: range.startColumn
        })
        const end = model.getOffsetAt({ lineNumber: range.endLineNumber, column: range.endColumn })
        const offers = offersFor(ctx, ALL_RULES, { start, end })

        const actions: Monaco.languages.CodeAction[] = offers
          // A hint with no rewrite has nothing to offer the code-action menu; it
          // shows up in the Problems panel instead.
          .filter((o) => !o.rule.hintOnly)
          .map((offer) => ({
            title: offer.match.title ?? offer.rule.title,
            kind: offer.rule.kind === 'quickfix' ? 'quickfix' : `refactor.${offer.rule.category}`,
            command: {
              id: APPLY_COMMAND,
              title: offer.match.title ?? offer.rule.title,
              arguments: [
                {
                  uri: model.uri.toString(),
                  ruleId: offer.rule.id,
                  start: offer.match.start,
                  end: offer.match.end
                } satisfies ApplyArgs
              ]
            }
          }))

        return { actions, dispose: () => {} }
      }
    },
    // Monaco filters the refactor picker by these; `quickfix` keeps the
    // lightbulb offering the same rules at the cursor.
    { providedCodeActionKinds: ['refactor', 'quickfix'] }
  )

  const disposable: Monaco.IDisposable = {
    dispose: () => {
      provider.dispose()
      applyCommand?.dispose()
      tidyCommand?.dispose()
    }
  }

  if (import.meta.hot) {
    import.meta.hot.dispose(() => {
      disposable.dispose()
      contextCache.clear()
      g[REGISTERED_KEY] = false
    })
  }

  return disposable
}
