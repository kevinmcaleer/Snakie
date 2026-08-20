import { ipcMain, type WebContents } from 'electron'
import type { IpcResult } from '../device/types'
import { getKey, hasKey, isEncryptionAvailable, setKey } from './keyStore'
import { fetchAvailableModels, getProviderConfig, setProviderConfig } from './providers/providerConfig'
import { DEFAULT_PROVIDER_ID, getProvider, listProviders } from './providers/registry'
import {
  clearCopilotTokenCache,
  pollCopilotDeviceFlow,
  startCopilotDeviceFlow,
  type CopilotDeviceCode,
  type CopilotPollResult
} from './providers/copilotAuth'
import type {
  LlmCompleteRequest,
  LlmKeyStatus,
  LlmProviderInfo,
  LlmSendRequest,
  LlmStreamEvent
} from './types'

const COPILOT_PROVIDER_ID = 'copilot'

export const LLM_CHANNELS = {
  stream: 'llm:stream',
  listProviders: 'llm:listProviders',
  getKeyStatus: 'llm:getKeyStatus',
  setKey: 'llm:setKey',
  sendMessage: 'llm:sendMessage',
  complete: 'llm:complete',
  copilotDeviceStart: 'llm:copilotDeviceStart',
  copilotDevicePoll: 'llm:copilotDevicePoll',
  getProviderConfig: 'llm:getProviderConfig',
  setProviderConfig: 'llm:setProviderConfig',
  fetchModels: 'llm:fetchModels'
} as const

const MAX_COMPLETION_PREFIX = 4000
const MAX_COMPLETION_SUFFIX = 1000

let requestCounter = 0

async function wrap<T>(fn: () => Promise<T>): Promise<IpcResult<T>> {
  try {
    return { ok: true, value: await fn() }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

export function registerLlmIpc(getWebContents: () => WebContents | undefined): void {
  const push = (event: LlmStreamEvent): void => {
    const wc = getWebContents()
    if (wc && !wc.isDestroyed()) wc.send(LLM_CHANNELS.stream, event)
  }

  ipcMain.handle(LLM_CHANNELS.listProviders, () =>
    wrap(async (): Promise<LlmProviderInfo[]> => listProviders())
  )

  ipcMain.handle(LLM_CHANNELS.getKeyStatus, (_e, providerId?: string) =>
    wrap(
      async (): Promise<LlmKeyStatus> => ({
        hasKey: await hasKey(providerId || DEFAULT_PROVIDER_ID),
        secure: isEncryptionAvailable()
      })
    )
  )

  ipcMain.handle(LLM_CHANNELS.setKey, (_e, providerId: string, key: string) =>
    wrap(() => setKey(providerId || DEFAULT_PROVIDER_ID, key))
  )

  ipcMain.handle(LLM_CHANNELS.sendMessage, (_e, req: LlmSendRequest) =>
    wrap(async (): Promise<string> => {
      const providerId = req.providerId || DEFAULT_PROVIDER_ID
      const provider = getProvider(providerId)
      if (!provider) {
        throw new Error(`Unknown LLM provider "${providerId}".`)
      }

      const apiKey = await getKey(providerId)
      if (!apiKey && providerId !== 'local') {
        throw new Error(
          `No API key set for ${provider.info.label}. Add your key in the chat settings.`
        )
      }

      const requestId = `req-${++requestCounter}`
      push({ type: 'start', requestId })
      try {
        const full = await provider.streamChat({
          apiKey: apiKey || '',
          model: req.model || provider.info.defaultModel,
          effort: req.effort,
          speed: req.speed,
          messages: req.messages,
          context: { activeFile: req.activeFile, consoleOutput: req.consoleOutput },
          onDelta: (text) => push({ type: 'delta', requestId, text })
        })
        push({ type: 'done', requestId })
        return full
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        push({ type: 'error', requestId, message })
        throw err
      }
    })
  )

  ipcMain.handle(LLM_CHANNELS.complete, (_e, req: LlmCompleteRequest) =>
    wrap(async (): Promise<string> => {
      const providerId = req.providerId || DEFAULT_PROVIDER_ID
      const provider = getProvider(providerId)
      if (!provider) {
        throw new Error(`Unknown LLM provider "${providerId}".`)
      }

      const apiKey = await getKey(providerId)
      if (!apiKey && providerId !== 'local') {
        return ''
      }

      const prefix = (req.prefix ?? '').slice(-MAX_COMPLETION_PREFIX)
      const suffix = (req.suffix ?? '').slice(0, MAX_COMPLETION_SUFFIX)

      return provider.complete({
        apiKey: apiKey || '',
        model: req.model || provider.info.defaultCompletionModel || provider.info.defaultModel,
        prefix,
        suffix,
        language: req.language || 'python'
      })
    })
  )

  ipcMain.handle(LLM_CHANNELS.copilotDeviceStart, () =>
    wrap(async (): Promise<CopilotDeviceCode> => startCopilotDeviceFlow())
  )

  ipcMain.handle(LLM_CHANNELS.copilotDevicePoll, (_e, deviceCode: string) =>
    wrap(async (): Promise<CopilotPollResult> => {
      const result = await pollCopilotDeviceFlow(deviceCode)
      if (result.status === 'authorized' && result.token) {
        await setKey(COPILOT_PROVIDER_ID, result.token)
        clearCopilotTokenCache()
        return { status: 'authorized' }
      }
      return { status: result.status, message: result.message }
    })
  )

  ipcMain.handle(LLM_CHANNELS.getProviderConfig, (_e, providerId: string) =>
    wrap(async (): Promise<Record<string, string>> => {
      return getProviderConfig(providerId || DEFAULT_PROVIDER_ID)
    })
  )

  ipcMain.handle(
    LLM_CHANNELS.setProviderConfig,
    (_e, providerId: string, config: Record<string, string>) =>
      wrap(() => setProviderConfig(providerId || DEFAULT_PROVIDER_ID, config))
  )

  ipcMain.handle(LLM_CHANNELS.fetchModels, (_e, baseURL: string) =>
    wrap(async (): Promise<string[]> => fetchAvailableModels(baseURL))
  )
}
