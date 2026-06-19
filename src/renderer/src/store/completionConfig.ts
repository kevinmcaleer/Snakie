/**
 * Inline-autocomplete config bridge (issue #82).
 *
 * The chat settings own the inline-completion knobs (on/off + the per-provider
 * fast model), persisted to `localStorage`. The Monaco inline-completion
 * provider — registered once, outside React — needs to read those knobs live on
 * every keystroke pause WITHOUT a remount.
 *
 * This module is the seam between the two:
 *   - the same `localStorage` keys the ChatPanel `useLocalStorage` hooks use, so
 *     there is a single source of truth;
 *   - pure reader helpers the Monaco provider calls at suggestion time (always
 *     current — no stale closure);
 *   - {@link notifyCompletionConfigChanged} which the ChatPanel fires after a
 *     change so any interested listener can react immediately (the provider
 *     itself re-reads lazily, so this is mostly for symmetry / future use).
 */

/** localStorage key: master on/off for inline autocomplete (default OFF). */
export const COMPLETION_ENABLED_KEY = 'snakie.chat.completion.enabled'
/** localStorage key: the selected chat provider id (shared with the chat). */
export const CHAT_PROVIDER_KEY = 'snakie.chat.provider'
/**
 * localStorage key: per-provider completion-model overrides, stored as one JSON
 * record `{ [providerId]: modelId }` (mirrors the chat's `snakie.chat.models`).
 * Exported so the ChatPanel and the Monaco provider share a single source.
 */
export const COMPLETION_MODELS_KEY = 'snakie.chat.completionModels'
/** Window event fired when any completion config value changes. */
export const COMPLETION_CONFIG_EVENT = 'snakie:completion-config-changed'

/** Safely read + JSON-parse a localStorage value, falling back on any error. */
function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key)
    return raw === null ? fallback : (JSON.parse(raw) as T)
  } catch {
    return fallback
  }
}

/** Whether inline autocomplete is enabled. Defaults to OFF (opt-in). */
export function isCompletionEnabled(): boolean {
  return readJson<boolean>(COMPLETION_ENABLED_KEY, false)
}

/** The currently-selected chat provider id (shared with the chat panel). */
export function completionProviderId(): string {
  return readJson<string>(CHAT_PROVIDER_KEY, 'anthropic')
}

/**
 * The completion model for `providerId`: the user's per-provider override if set,
 * else the provider's `defaultCompletionModel` (passed in by the caller, which
 * has the provider registry), else an empty string (main will default again).
 */
export function completionModelFor(providerId: string, defaultCompletionModel?: string): string {
  const overrides = readJson<Record<string, string>>(COMPLETION_MODELS_KEY, {})
  return overrides[providerId] || defaultCompletionModel || ''
}

/** Broadcast that the completion config changed so live listeners can react. */
export function notifyCompletionConfigChanged(): void {
  window.dispatchEvent(new CustomEvent(COMPLETION_CONFIG_EVENT))
}
