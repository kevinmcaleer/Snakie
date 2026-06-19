/**
 * AI inline completions (ghost text) for Monaco — issue #82.
 *
 * Registers a SINGLE `InlineCompletionsProvider` for the languages we edit
 * (`python`, `plaintext`, `markdown`), guarded against HMR double-registration
 * the same way the plugin code-action provider is. Behaviour, per the issue:
 *
 *  - only runs when inline autocomplete is enabled AND the selected chat
 *    provider has a stored API key;
 *  - debounces ~350ms after the last keystroke (so it fires on a typing pause,
 *    not every character);
 *  - sends a bounded prefix (last ~2000 chars before the cursor) + a short
 *    suffix as FIM context, never the whole file;
 *  - cancels the in-flight request when Monaco cancels (new input) — both the
 *    debounce timer and the network call (via an AbortController bridged to the
 *    cancellation token);
 *  - returns the model's text as a single inline-completion item (ghost text).
 *
 * All provider network calls happen in main (`window.api.llm.complete`); this
 * module only orchestrates the editor side.
 */
import type * as Monaco from 'monaco-editor/esm/vs/editor/editor.api'
import type { LlmProviderInfo } from '../../../preload/index.d'
import {
  completionModelFor,
  completionProviderId,
  isCompletionEnabled
} from '../store/completionConfig'

/** Debounce window (ms) before asking the model for a suggestion. */
const COMPLETION_DEBOUNCE_MS = 350

/** Max characters of context sent before the cursor (the rest is dropped). */
const MAX_PREFIX_CHARS = 2000
/** Max characters of context sent after the cursor. */
const MAX_SUFFIX_CHARS = 500

/** Languages that get AI ghost text. */
const LANGUAGES = ['python', 'plaintext', 'markdown'] as const

/** Marker key making double-registration idempotent across HMR. */
const REGISTERED_KEY = '__snakieInlineCompletionsRegistered'

type GuardedGlobal = typeof globalThis & { [REGISTERED_KEY]?: boolean }

// ── Provider metadata + key-status cache ─────────────────────────────────────
// Loaded lazily so the registered provider stays out of React. `listProviders`
// is cheap and static; key status is re-checked whenever it reports no key (so a
// freshly-saved key is picked up) but cached once positive.

let providersCache: LlmProviderInfo[] | null = null
let providersPromise: Promise<LlmProviderInfo[]> | null = null
const keyStatusCache = new Map<string, boolean>()

async function getProviders(): Promise<LlmProviderInfo[]> {
  if (providersCache) return providersCache
  if (!providersPromise) {
    providersPromise = window.api.llm
      .listProviders()
      .then((list) => {
        providersCache = list
        return list
      })
      .catch(() => [])
  }
  return providersPromise
}

async function providerHasKey(providerId: string): Promise<boolean> {
  if (keyStatusCache.get(providerId)) return true
  try {
    const status = await window.api.llm.getKeyStatus(providerId)
    keyStatusCache.set(providerId, status.hasKey)
    return status.hasKey
  } catch {
    return false
  }
}

/** Sleep that rejects when the cancellation token fires, so debounce is cancelable. */
function debounce(ms: number, token: Monaco.CancellationToken): Promise<void> {
  return new Promise((resolve, reject) => {
    if (token.isCancellationRequested) return reject(new Error('cancelled'))
    const timer = setTimeout(resolve, ms)
    token.onCancellationRequested(() => {
      clearTimeout(timer)
      reject(new Error('cancelled'))
    })
  })
}

/** Bounded prefix (text before the cursor) for the current model + position. */
function prefixBefore(model: Monaco.editor.ITextModel, position: Monaco.Position): string {
  const full = model.getValueInRange({
    startLineNumber: 1,
    startColumn: 1,
    endLineNumber: position.lineNumber,
    endColumn: position.column
  })
  return full.length > MAX_PREFIX_CHARS ? full.slice(-MAX_PREFIX_CHARS) : full
}

/** Bounded suffix (text after the cursor) for the current model + position. */
function suffixAfter(model: Monaco.editor.ITextModel, position: Monaco.Position): string {
  const lastLine = model.getLineCount()
  const full = model.getValueInRange({
    startLineNumber: position.lineNumber,
    startColumn: position.column,
    endLineNumber: lastLine,
    endColumn: model.getLineMaxColumn(lastLine)
  })
  return full.length > MAX_SUFFIX_CHARS ? full.slice(0, MAX_SUFFIX_CHARS) : full
}

const EMPTY: Monaco.languages.InlineCompletions = { items: [] }

/**
 * Register the AI inline-completion provider. Idempotent: the first call wins,
 * later calls (e.g. HMR re-eval) are no-ops. Returns the disposables on first
 * registration, otherwise `undefined`.
 */
export function registerInlineCompletions(monaco: typeof Monaco): Monaco.IDisposable[] | undefined {
  const g = globalThis as GuardedGlobal
  if (g[REGISTERED_KEY]) return undefined
  g[REGISTERED_KEY] = true

  const provider: Monaco.languages.InlineCompletionsProvider = {
    async provideInlineCompletions(model, position, _context, token) {
      // Opt-in only — return fast when disabled so typing stays snappy.
      if (!isCompletionEnabled()) return EMPTY

      const providerId = completionProviderId()
      const providers = await getProviders()
      if (token.isCancellationRequested) return EMPTY
      const info = providers.find((p) => p.id === providerId)
      if (!info) return EMPTY

      // No key → no suggestion (don't spend a round-trip on a guaranteed empty).
      if (!(await providerHasKey(providerId))) return EMPTY
      if (token.isCancellationRequested) return EMPTY

      // Debounce: wait for a typing pause; bail if cancelled meanwhile.
      try {
        await debounce(COMPLETION_DEBOUNCE_MS, token)
      } catch {
        return EMPTY
      }

      const prefix = prefixBefore(model, position)
      const suffix = suffixAfter(model, position)
      // Skip empty buffers — nothing useful to complete.
      if (!prefix.trim() && !suffix.trim()) return EMPTY

      // Bridge Monaco's cancellation token to an AbortController so the network
      // call in main is actually aborted when the user keeps typing.
      const ac = new AbortController()
      const sub = token.onCancellationRequested(() => ac.abort())

      try {
        const text = await window.api.llm.complete({
          providerId,
          model: completionModelFor(providerId, info.defaultCompletionModel),
          prefix,
          suffix,
          language: model.getLanguageId()
        })
        if (token.isCancellationRequested || ac.signal.aborted || !text) return EMPTY

        const range = new monaco.Range(
          position.lineNumber,
          position.column,
          position.lineNumber,
          position.column
        )
        return { items: [{ insertText: text, range }] }
      } catch {
        // Network/abort/no-key — never disrupt typing; just show nothing.
        return EMPTY
      } finally {
        sub.dispose()
      }
    },
    freeInlineCompletions() {
      // Items hold no disposable resources.
    }
  }

  const disposables = LANGUAGES.map((lang) =>
    monaco.languages.registerInlineCompletionsProvider(lang, provider)
  )

  if (import.meta.hot) {
    import.meta.hot.dispose(() => {
      disposables.forEach((d) => d.dispose())
      providersCache = null
      providersPromise = null
      keyStatusCache.clear()
      g[REGISTERED_KEY] = false
    })
  }

  return disposables
}

/**
 * Forget the cached key status for a provider (or all). Called when the user
 * saves/removes a key so a fresh suggestion attempt re-checks rather than using
 * a stale "no key" result.
 */
export function invalidateCompletionKeyStatus(providerId?: string): void {
  if (providerId) keyStatusCache.delete(providerId)
  else keyStatusCache.clear()
}
