import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { LlmKeyStatus, LlmProviderInfo } from '../../../preload/index.d'
import {
  CHAT_PROVIDER_KEY,
  COMPLETION_ENABLED_KEY,
  COMPLETION_MODELS_KEY,
  notifyCompletionConfigChanged
} from '../store/completionConfig'
import { invalidateCompletionKeyStatus } from '../components/inline-completions'

const PROVIDER_KEY = CHAT_PROVIDER_KEY
const MODELS_KEY = 'snakie.chat.models'
const EFFORTS_KEY = 'snakie.chat.efforts'
const SPEEDS_KEY = 'snakie.chat.speeds'

const CHAT_CONFIG_EVENT = 'snakie:chat-config-changed'

function notifyChatConfigChanged(): void {
  window.dispatchEvent(new CustomEvent(CHAT_CONFIG_EVENT))
}

function readStored<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key)
    return raw === null ? fallback : (JSON.parse(raw) as T)
  } catch {
    return fallback
  }
}

function writeStored<T>(key: string, value: T): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Ignore write failures (e.g. storage disabled / quota).
  }
}

export interface ChatProvidersStore {
  providers: LlmProviderInfo[]
  provider: LlmProviderInfo | undefined
  providerId: string
  setProviderId: (id: string) => void
  model: string
  setModel: (id: string) => void
  effort: string | undefined
  setEffort: (v: string) => void
  speed: string | undefined
  setSpeed: (v: string) => void
  completionEnabled: boolean
  setCompletionEnabled: (v: boolean) => void
  completionModel: string
  setCompletionModel: (id: string) => void
  keyStatus: LlmKeyStatus | null
  refreshKeyStatus: () => Promise<void>
  error: string | null
  baseUrl: string
  setBaseUrl: (url: string) => Promise<void>
  customModel: string
  setCustomModel: (model: string) => Promise<void>
  availableModels: string[]
  fetchModels: (baseURL: string) => Promise<void>
  modelsLoading: boolean
  modelsError: string | null
}

export function useChatProviders(): ChatProvidersStore {
  const [providers, setProviders] = useState<LlmProviderInfo[]>([])
  const [error, setError] = useState<string | null>(null)
  const [keyStatus, setKeyStatus] = useState<LlmKeyStatus | null>(null)
  const [baseUrl, setBaseUrlState] = useState<string>('')
  const [customModel, setCustomModelState] = useState<string>('')
  const [availableModels, setAvailableModels] = useState<string[]>([])
  const [modelsLoading, setModelsLoading] = useState(false)
  const [modelsError, setModelsError] = useState<string | null>(null)
  const [, setTick] = useState(0)

  useEffect(() => {
    void window.api.llm
      .listProviders()
      .then(setProviders)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
  }, [])

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

  // Load provider config (base URL, custom model name) from main process
  useEffect(() => {
    if (!provider || provider.id !== 'local') return
    void window.api.llm
      .getProviderConfig('local')
      .then((cfg) => {
        setBaseUrlState(cfg.baseURL || 'http://localhost:11434/v1')
        setCustomModelState(cfg.model || '')
      })
      .catch(() => undefined)
  }, [provider])

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

  const setBaseUrl = useCallback(async (url: string): Promise<void> => {
    setBaseUrlState(url)
    await window.api.llm.setProviderConfig('local', {
      baseURL: url,
      model: customModel
    })
    notifyChatConfigChanged()
  }, [customModel])

  const setCustomModelFn = useCallback(async (model: string): Promise<void> => {
    setCustomModelState(model)
    await window.api.llm.setProviderConfig('local', {
      baseURL: baseUrl,
      model
    })
    notifyChatConfigChanged()
  }, [baseUrl])

  const fetchModelsFn = useCallback(async (baseURL: string): Promise<void> => {
    setModelsLoading(true)
    setModelsError(null)
    try {
      const models = await window.api.llm.fetchModels(baseURL)
      setAvailableModels(models)
      // Also persist so ChatPanel can access them
      writeStored('snakie.chat.localModels', models)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setModelsError(msg)
      setAvailableModels([])
    } finally {
      setModelsLoading(false)
    }
  }, [])

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
    error,
    baseUrl,
    setBaseUrl,
    customModel,
    setCustomModel: setCustomModelFn,
    availableModels,
    fetchModels: fetchModelsFn,
    modelsLoading,
    modelsError
  }
}

export { notifyChatConfigChanged, invalidateCompletionKeyStatus }
