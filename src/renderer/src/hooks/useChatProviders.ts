import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { LlmKeyStatus, LlmProviderInfo } from '../../../preload/index.d'
import {
  CHAT_PROVIDER_KEY,
  COMPLETION_ENABLED_KEY,
  COMPLETION_MODELS_KEY,
  notifyCompletionConfigChanged
} from '../store/completionConfig'
import { invalidateCompletionKeyStatus } from '../components/inline-completions'

/**
 * Shared chat-provider state (issues #77/#78/#82, split out in #83)
 * ================================================================
 *
 * The chat lives in TWO places now: the {@link ChatPanel} (quick footer +
 * status + thread) and the Settings dialog's Chat tab (API keys, Copilot
 * sign-in, autocomplete). Both edit the SAME persisted values — the provider
 * registry, the per-provider model/effort/speed selection, the per-provider key
 * status, and the autocomplete knobs — so this hook centralises them.
 *
 * The selections are read DIRECTLY from `localStorage` on each render-tick
 * (rather than via `useLocalStorage`, which caches per-instance and only re-reads
 * when its key changes) so two consumers stay in sync. Any write persists to
 * `localStorage` and broadcasts {@link CHAT_CONFIG_EVENT}; every consumer bumps
 * a tick on that event and re-reads — giving a single live source of truth
 * across the panel and the dialog without prop-drilling.
 */

/** Persisted localStorage keys (same keys the chat has always used). The
 * provider key is shared with the completion provider via completionConfig. */
const PROVIDER_KEY = CHAT_PROVIDER_KEY
const MODELS_KEY = 'snakie.chat.models'
const EFFORTS_KEY = 'snakie.chat.efforts'
const SPEEDS_KEY = 'snakie.chat.speeds'

/** Window event fired when any shared chat config value changes. */
const CHAT_CONFIG_EVENT = 'snakie:chat-config-changed'

/** Broadcast that a shared chat config value changed so siblings re-read. */
function notifyChatConfigChanged(): void {
  window.dispatchEvent(new CustomEvent(CHAT_CONFIG_EVENT))
}

/** Safely read + JSON-parse a localStorage value, falling back on any error. */
function readStored<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key)
    return raw === null ? fallback : (JSON.parse(raw) as T)
  } catch {
    return fallback
  }
}

/** Persist a value to localStorage (ignoring write failures). */
function writeStored<T>(key: string, value: T): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Ignore write failures (e.g. storage disabled / quota).
  }
}

export interface ChatProvidersStore {
  /** All providers from the main-process registry (empty until loaded). */
  providers: LlmProviderInfo[]
  /** The currently selected provider (or the first as a fallback). */
  provider: LlmProviderInfo | undefined
  /** Selected provider id. */
  providerId: string
  setProviderId: (id: string) => void
  /** Selected chat model for the active provider. */
  model: string
  setModel: (id: string) => void
  /** Selected reasoning effort for the active provider (undefined = auto). */
  effort: string | undefined
  setEffort: (v: string) => void
  /** Selected speed tier for the active provider (undefined = auto). */
  speed: string | undefined
  setSpeed: (v: string) => void
  /** Whether inline autocomplete is enabled (issue #82). */
  completionEnabled: boolean
  setCompletionEnabled: (v: boolean) => void
  /** The fast completion model for the active provider. */
  completionModel: string
  setCompletionModel: (id: string) => void
  /** Key status for the active provider (null until first probe). */
  keyStatus: LlmKeyStatus | null
  /** Re-probe the active provider's key status. */
  refreshKeyStatus: () => Promise<void>
  /** Any load/probe error to surface. */
  error: string | null
}

/**
 * Subscribe to the shared chat-provider config. Pass a fresh provider registry
 * load on the first consumer; subsequent consumers reuse the broadcast values.
 */
export function useChatProviders(): ChatProvidersStore {
  const [providers, setProviders] = useState<LlmProviderInfo[]>([])
  const [error, setError] = useState<string | null>(null)
  const [keyStatus, setKeyStatus] = useState<LlmKeyStatus | null>(null)
  // Bump to force a re-read of the localStorage-backed selections below after a
  // sibling consumer writes (the broadcast handler increments this).
  const [, setTick] = useState(0)

  // Load the provider registry once.
  useEffect(() => {
    void window.api.llm
      .listProviders()
      .then(setProviders)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
  }, [])

  // Read all persisted selections fresh from localStorage on every render. This
  // (vs caching in useState/useLocalStorage) is what lets the footer and the
  // Settings Chat tab show identical values the instant either writes — the
  // broadcast below re-renders both, and both re-read here.
  const providerId = readStored<string>(PROVIDER_KEY, 'anthropic')
  const modelByProvider = readStored<Record<string, string>>(MODELS_KEY, {})
  const effortByProvider = readStored<Record<string, string>>(EFFORTS_KEY, {})
  const speedByProvider = readStored<Record<string, string>>(SPEEDS_KEY, {})
  const completionEnabled = readStored<boolean>(COMPLETION_ENABLED_KEY, false)
  const completionModelByProvider = readStored<Record<string, string>>(COMPLETION_MODELS_KEY, {})

  const provider = useMemo(
    () => providers.find((p) => p.id === providerId) ?? providers[0],
    [providers, providerId]
  )

  const model = (provider && modelByProvider[provider.id]) || provider?.defaultModel || ''
  const effort = provider ? effortByProvider[provider.id] : undefined
  const speed = provider ? speedByProvider[provider.id] : undefined
  const completionModel =
    (provider && completionModelByProvider[provider.id]) ||
    provider?.defaultCompletionModel ||
    provider?.defaultModel ||
    ''

  const refreshKeyStatus = useCallback(async (): Promise<void> => {
    if (!provider) return
    try {
      const status = await window.api.llm.getKeyStatus(provider.id)
      setKeyStatus(status)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [provider])

  useEffect(() => {
    void refreshKeyStatus()
  }, [refreshKeyStatus])

  // Re-render (re-reading the selections above) AND re-probe the key status when
  // a sibling consumer writes (e.g. the Settings dialog saves a key or switches
  // provider), so the two instances stay in sync without a remount. A ref keeps
  // the listener stable while always calling the latest refresh.
  const refreshRef = useRef(refreshKeyStatus)
  refreshRef.current = refreshKeyStatus
  useEffect(() => {
    const onChange = (): void => {
      setTick((n) => n + 1)
      void refreshRef.current()
    }
    window.addEventListener(CHAT_CONFIG_EVENT, onChange)
    return () => window.removeEventListener(CHAT_CONFIG_EVENT, onChange)
  }, [])

  // Setters persist to localStorage then broadcast so every consumer re-reads.
  const setProviderId = useCallback((id: string): void => {
    writeStored(PROVIDER_KEY, id)
    notifyChatConfigChanged()
  }, [])
  const setModel = useCallback(
    (next: string): void => {
      if (!provider) return
      writeStored(MODELS_KEY, { ...readStored<Record<string, string>>(MODELS_KEY, {}), [provider.id]: next })
      notifyChatConfigChanged()
    },
    [provider]
  )
  const setEffort = useCallback(
    (next: string): void => {
      if (!provider) return
      writeStored(EFFORTS_KEY, {
        ...readStored<Record<string, string>>(EFFORTS_KEY, {}),
        [provider.id]: next
      })
      notifyChatConfigChanged()
    },
    [provider]
  )
  const setSpeed = useCallback(
    (next: string): void => {
      if (!provider) return
      writeStored(SPEEDS_KEY, {
        ...readStored<Record<string, string>>(SPEEDS_KEY, {}),
        [provider.id]: next
      })
      notifyChatConfigChanged()
    },
    [provider]
  )
  const setCompletionEnabled = useCallback((next: boolean): void => {
    writeStored(COMPLETION_ENABLED_KEY, next)
    notifyCompletionConfigChanged()
    notifyChatConfigChanged()
  }, [])
  const setCompletionModel = useCallback(
    (next: string): void => {
      if (!provider) return
      writeStored(COMPLETION_MODELS_KEY, {
        ...readStored<Record<string, string>>(COMPLETION_MODELS_KEY, {}),
        [provider.id]: next
      })
      notifyCompletionConfigChanged()
      notifyChatConfigChanged()
    },
    [provider]
  )

  return {
    providers,
    provider,
    providerId,
    setProviderId,
    model,
    setModel,
    effort,
    setEffort,
    speed,
    setSpeed,
    completionEnabled,
    setCompletionEnabled,
    completionModel,
    setCompletionModel,
    keyStatus,
    refreshKeyStatus,
    error
  }
}

/** Re-export so consumers can fire the broadcast after an out-of-hook key write. */
export { notifyChatConfigChanged, invalidateCompletionKeyStatus }
