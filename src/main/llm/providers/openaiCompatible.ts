/**
 * Generic OpenAI-compatible chat provider (issue #77).
 *
 * Speaks the `/chat/completions` SSE streaming protocol used by OpenAI, xAI
 * (Grok), and GitHub Copilot. We use the global `fetch` rather than adding the
 * heavy `openai` SDK dependency — the wire format is small and stable: POST a
 * JSON body with `stream: true`, then read `data:` lines off the response,
 * accumulating `choices[0].delta.content`, stopping on `[DONE]`.
 *
 * All requests run in the MAIN process (the renderer CSP blocks external
 * requests). The API key never leaves main and is never logged.
 */
import {
  COMPLETION_SYSTEM_PROMPT,
  buildCompletionUserPrompt,
  buildSystemString,
  sanitizeCompletion
} from './context'
import { getCopilotToken } from './copilotAuth'
import { getProviderConfig } from './providerConfig'
import type { CompleteArgs, Provider, ProviderInfo, StreamChatArgs } from './types'

/** Upper bound on inline-completion output tokens — small + fast (issue #82). */
const COMPLETION_MAX_TOKENS = 64

/** Config that distinguishes one OpenAI-compatible backend from another. */
export interface OpenAiCompatibleConfig {
  info: ProviderInfo
  baseURL: string
  extraHeaders?: Record<string, string>
  reasoningModels?: string[]
  resolveBearer?: (apiKey: string, signal?: AbortSignal) => Promise<string>
}

interface ChatCompletionChunk {
  choices?: Array<{ delta?: { content?: string | null } }>
}

export function parseOpenAiSsePayload(payload: string): string | null {
  const trimmed = payload.trim()
  if (!trimmed || trimmed === '[DONE]') return null
  try {
    const chunk = JSON.parse(trimmed) as ChatCompletionChunk
    return chunk.choices?.[0]?.delta?.content ?? null
  } catch {
    return null
  }
}

export async function streamOpenAiCompatible(
  config: OpenAiCompatibleConfig,
  args: StreamChatArgs
): Promise<string> {
  const { apiKey, model, effort, messages, context, onDelta, signal } = args

  const system = buildSystemString(context)
  const body: Record<string, unknown> = {
    model,
    stream: true,
    messages: [
      { role: 'system', content: system },
      ...messages.map((m) => ({ role: m.role, content: m.content }))
    ]
  }

  if (effort && config.reasoningModels?.includes(model)) {
    body.reasoning_effort = effort
  }

  const bearer = config.resolveBearer ? await config.resolveBearer(apiKey, signal) : apiKey
  const res = await fetch(`${config.baseURL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${bearer}`,
      ...(config.extraHeaders ?? {})
    },
    body: JSON.stringify(body),
    signal
  })

  if (!res.ok || !res.body) {
    const detail = await safeErrorText(res)
    throw new Error(
      `${config.info.label} request failed (HTTP ${res.status})${detail ? `: ${detail}` : ''}`
    )
  }

  return await consumeSse(res.body, onDelta)
}

export async function completeOpenAiCompatible(
  config: OpenAiCompatibleConfig,
  args: CompleteArgs
): Promise<string> {
  const { apiKey, model, prefix, suffix, language, signal } = args

  const body: Record<string, unknown> = {
    model,
    stream: false,
    max_tokens: COMPLETION_MAX_TOKENS,
    messages: [
      { role: 'system', content: COMPLETION_SYSTEM_PROMPT },
      { role: 'user', content: buildCompletionUserPrompt({ prefix, suffix, language }) }
    ]
  }

  const bearer = config.resolveBearer ? await config.resolveBearer(apiKey, signal) : apiKey
  const res = await fetch(`${config.baseURL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${bearer}`,
      ...(config.extraHeaders ?? {})
    },
    body: JSON.stringify(body),
    signal
  })

  if (!res.ok) {
    const detail = await safeErrorText(res)
    throw new Error(
      `${config.info.label} completion failed (HTTP ${res.status})${detail ? `: ${detail}` : ''}`
    )
  }

  const json = (await res.json()) as {
    choices?: Array<{ message?: { content?: string | null } }>
  }
  const text = json.choices?.[0]?.message?.content ?? ''
  return sanitizeCompletion(text)
}

async function consumeSse(
  body: ReadableStream<Uint8Array>,
  onDelta: (text: string) => void
): Promise<string> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let full = ''

  const flushEvent = (raw: string): boolean => {
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim()
      if (!trimmed.startsWith('data:')) continue
      const payload = trimmed.slice('data:'.length).trim()
      if (payload === '[DONE]') return true
      const delta = parseOpenAiSsePayload(payload)
      if (delta) {
        full += delta
        onDelta(delta)
      }
    }
    return false
  }

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let sep: number
    while ((sep = buffer.indexOf('\n\n')) !== -1) {
      const event = buffer.slice(0, sep)
      buffer = buffer.slice(sep + 2)
      if (flushEvent(event)) {
        await reader.cancel().catch(() => undefined)
        return full
      }
    }
  }
  if (buffer.trim()) flushEvent(buffer)
  return full
}

async function safeErrorText(res: Response): Promise<string> {
  try {
    const text = await res.text()
    try {
      const json = JSON.parse(text) as { error?: { message?: string } }
      return json.error?.message ?? text.slice(0, 200)
    } catch {
      return text.slice(0, 200)
    }
  } catch {
    return ''
  }
}

export function makeOpenAiCompatibleProvider(config: OpenAiCompatibleConfig): Provider {
  return {
    info: config.info,
    streamChat: (args) => streamOpenAiCompatible(config, args),
    complete: (args) => completeOpenAiCompatible(config, args)
  }
}

// ── Concrete providers ────────────────────────────────────────────────────

export const openaiProvider = makeOpenAiCompatibleProvider({
  info: {
    id: 'openai',
    label: 'OpenAI',
    models: [
      { id: 'gpt-4o', label: 'GPT-4o' },
      { id: 'gpt-4o-mini', label: 'GPT-4o mini' },
      { id: 'o4-mini', label: 'o4-mini (reasoning)' }
    ],
    defaultModel: 'gpt-4o',
    defaultCompletionModel: 'gpt-4o-mini',
    efforts: ['low', 'medium', 'high'],
    keyHint: 'OpenAI API key (sk-…)',
    keyUrl: 'https://platform.openai.com/api-keys'
  },
  baseURL: 'https://api.openai.com/v1',
  reasoningModels: ['o4-mini']
})

export const grokProvider = makeOpenAiCompatibleProvider({
  info: {
    id: 'grok',
    label: 'Grok (xAI)',
    models: [
      { id: 'grok-2-latest', label: 'Grok 2 (latest)' },
      { id: 'grok-2', label: 'Grok 2' }
    ],
    defaultModel: 'grok-2-latest',
    defaultCompletionModel: 'grok-2',
    keyHint: 'xAI API key (xai-…)',
    keyUrl: 'https://console.x.ai'
  },
  baseURL: 'https://api.x.ai/v1'
})

export const copilotProvider = makeOpenAiCompatibleProvider({
  info: {
    id: 'copilot',
    label: 'GitHub Copilot',
    models: [
      { id: 'gpt-4o', label: 'GPT-4o' },
      { id: 'gpt-4o-mini', label: 'GPT-4o mini' }
    ],
    defaultModel: 'gpt-4o',
    defaultCompletionModel: 'gpt-4o-mini',
    keyHint: 'Sign in with GitHub (active Copilot subscription required)',
    keyUrl: 'https://github.com/features/copilot',
    experimental: true
  },
  baseURL: 'https://api.githubcopilot.com',
  extraHeaders: {
    'Copilot-Integration-Id': 'vscode-chat',
    'Editor-Version': 'Snakie/1',
    'Editor-Plugin-Version': 'Snakie/1'
  },
  resolveBearer: getCopilotToken
})

// ── Local LLM (OpenAI-compatible) ─────────────────────────────────────────

const LOCAL_ID = 'local'

export const LOCAL_INFO: ProviderInfo = {
  id: LOCAL_ID,
  label: 'Local LLM',
  models: [{ id: 'custom', label: 'Custom' }],
  defaultModel: 'custom',
  defaultCompletionModel: 'custom',
  customModel: true,
  keyHint: 'API key (optional — leave blank for no auth)'
}

export const localProvider: Provider = {
  info: LOCAL_INFO,
  async streamChat(args: StreamChatArgs): Promise<string> {
    const config = await getProviderConfig(LOCAL_ID)
    const baseURL = config.baseURL || 'http://localhost:11434/v1'
    return streamOpenAiCompatible({ info: LOCAL_INFO, baseURL }, args)
  },
  async complete(args: CompleteArgs): Promise<string> {
    const config = await getProviderConfig(LOCAL_ID)
    const baseURL = config.baseURL || 'http://localhost:11434/v1'
    return completeOpenAiCompatible({ info: LOCAL_INFO, baseURL }, args)
  }
}
