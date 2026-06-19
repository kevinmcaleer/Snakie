/**
 * IPC handlers for the LLM chat layer (issue #77).
 *
 * Renderer-facing channels (all under `llm:`):
 *   - `llm:listProviders` → {@link LlmProviderInfo}[] — registry metadata for the UI.
 *   - `llm:getKeyStatus`  → {@link LlmKeyStatus} for a given providerId.
 *   - `llm:setKey`        → store/clear a given provider's API key.
 *   - `llm:sendMessage`   → run a streaming completion against the request's
 *                           provider; the assembled reply is returned, and
 *                           deltas are pushed on `llm:stream`.
 *
 * Push channel:
 *   - `llm:stream`        → {@link LlmStreamEvent} chunks for the active request.
 *
 * Errors cross IPC as the same serializable {@link IpcResult} shape used by the
 * device/fs layers. The API key never appears in a log line or an error message.
 */
import { ipcMain, type WebContents } from 'electron'
import type { IpcResult } from '../device/types'
import { getKey, hasKey, isEncryptionAvailable, setKey } from './keyStore'
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

/** Provider id whose key is a GitHub OAuth token obtained via the device flow. */
const COPILOT_PROVIDER_ID = 'copilot'

/** IPC channel names for the LLM layer. */
export const LLM_CHANNELS = {
  stream: 'llm:stream',
  listProviders: 'llm:listProviders',
  getKeyStatus: 'llm:getKeyStatus',
  setKey: 'llm:setKey',
  sendMessage: 'llm:sendMessage',
  complete: 'llm:complete',
  copilotDeviceStart: 'llm:copilotDeviceStart',
  copilotDevicePoll: 'llm:copilotDevicePoll'
} as const

/** Upper bound on the prompt context sent for a single inline completion. */
const MAX_COMPLETION_PREFIX = 4000
const MAX_COMPLETION_SUFFIX = 1000

/** Monotonic id so the renderer can correlate stream events with a request. */
let requestCounter = 0

/**
 * Wrap an async operation so any thrown error crosses IPC as a serializable
 * {@link IpcResult}. Mirrors the device/fs layers.
 */
async function wrap<T>(fn: () => Promise<T>): Promise<IpcResult<T>> {
  try {
    return { ok: true, value: await fn() }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/**
 * Register all `llm:*` IPC handlers. Call once from the main process after the
 * window exists.
 *
 * @param getWebContents resolver for the target renderer (so we never capture a
 *   destroyed window after a reload).
 */
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
      if (!apiKey) {
        throw new Error(
          `No API key set for ${provider.info.label}. Add your key in the chat settings.`
        )
      }

      const requestId = `req-${++requestCounter}`
      push({ type: 'start', requestId })
      try {
        const full = await provider.streamChat({
          apiKey,
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

  // One-shot inline completion (issue #82). Non-streaming: routes to the
  // provider's fast `complete` with that provider's stored key and returns the
  // raw text to insert at the cursor. The renderer cancels stale requests via
  // its IPC token; we additionally clamp the prefix/suffix here as a backstop.
  ipcMain.handle(LLM_CHANNELS.complete, (_e, req: LlmCompleteRequest) =>
    wrap(async (): Promise<string> => {
      const providerId = req.providerId || DEFAULT_PROVIDER_ID
      const provider = getProvider(providerId)
      if (!provider) {
        throw new Error(`Unknown LLM provider "${providerId}".`)
      }

      const apiKey = await getKey(providerId)
      if (!apiKey) {
        // No key → no suggestion. The renderer only calls this when it believes
        // a key is set, but guard anyway so a race never throws into the editor.
        return ''
      }

      const prefix = (req.prefix ?? '').slice(-MAX_COMPLETION_PREFIX)
      const suffix = (req.suffix ?? '').slice(0, MAX_COMPLETION_SUFFIX)

      return provider.complete({
        apiKey,
        model: req.model || provider.info.defaultCompletionModel || provider.info.defaultModel,
        prefix,
        suffix,
        language: req.language || 'python'
      })
    })
  )

  // GitHub Copilot sign-in (device flow). `start` returns the user code +
  // verification URL to show; the renderer then polls until authorized. The
  // `gho_` token never crosses to the renderer — on authorization we store it as
  // the Copilot provider's key here in main, so the existing token exchange can
  // turn it into a Copilot token on the next chat/completion request.
  ipcMain.handle(LLM_CHANNELS.copilotDeviceStart, () =>
    wrap(async (): Promise<CopilotDeviceCode> => startCopilotDeviceFlow())
  )

  ipcMain.handle(LLM_CHANNELS.copilotDevicePoll, (_e, deviceCode: string) =>
    wrap(async (): Promise<CopilotPollResult> => {
      const result = await pollCopilotDeviceFlow(deviceCode)
      if (result.status === 'authorized' && result.token) {
        await setKey(COPILOT_PROVIDER_ID, result.token)
        clearCopilotTokenCache()
        // Strip the token before it leaves the main process.
        return { status: 'authorized' }
      }
      return { status: result.status, message: result.message }
    })
  )
}
