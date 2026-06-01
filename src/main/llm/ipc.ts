/**
 * IPC handlers for the LLM (Claude) chat layer.
 *
 * Renderer-facing channels (all under `llm:`):
 *   - `llm:getKeyStatus`  → {@link LlmKeyStatus}
 *   - `llm:setKey`        → store/clear the Anthropic API key
 *   - `llm:sendMessage`   → run a streaming completion; the assembled reply is
 *                           returned, and deltas are pushed on `llm:stream`.
 *
 * Push channel:
 *   - `llm:stream`        → {@link LlmStreamEvent} chunks for the active request.
 *
 * Errors cross IPC as the same serializable {@link IpcResult} shape used by the
 * device/fs layers. The API key never appears in a log line or an error message.
 */
import { ipcMain, type WebContents } from 'electron'
import type { IpcResult } from '../device/types'
import { streamChat } from './client'
import { getKey, hasKey, isEncryptionAvailable, setKey } from './keyStore'
import type { LlmKeyStatus, LlmSendRequest, LlmStreamEvent } from './types'

/** IPC channel names for the LLM layer. */
export const LLM_CHANNELS = {
  stream: 'llm:stream',
  getKeyStatus: 'llm:getKeyStatus',
  setKey: 'llm:setKey',
  sendMessage: 'llm:sendMessage'
} as const

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

  ipcMain.handle(LLM_CHANNELS.getKeyStatus, () =>
    wrap(
      async (): Promise<LlmKeyStatus> => ({
        hasKey: await hasKey(),
        secure: isEncryptionAvailable()
      })
    )
  )

  ipcMain.handle(LLM_CHANNELS.setKey, (_e, key: string) => wrap(() => setKey(key)))

  ipcMain.handle(LLM_CHANNELS.sendMessage, (_e, req: LlmSendRequest) =>
    wrap(async (): Promise<string> => {
      const apiKey = await getKey()
      if (!apiKey) {
        throw new Error('No Anthropic API key set. Add your key in the chat settings.')
      }
      const requestId = `req-${++requestCounter}`
      push({ type: 'start', requestId })
      try {
        const full = await streamChat({
          apiKey,
          messages: req.messages,
          activeFile: req.activeFile,
          model: req.model,
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
}
