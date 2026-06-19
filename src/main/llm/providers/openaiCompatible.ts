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
import type { CompleteArgs, Provider, ProviderInfo, StreamChatArgs } from './types'

/** Upper bound on inline-completion output tokens — small + fast (issue #82). */
const COMPLETION_MAX_TOKENS = 64

/** Config that distinguishes one OpenAI-compatible backend from another. */
export interface OpenAiCompatibleConfig {
  /** Provider metadata surfaced to the renderer. */
  info: ProviderInfo
  /** Base URL up to (but not including) `/chat/completions`. */
  baseURL: string
  /** Extra headers to merge in (beyond Authorization). */
  extraHeaders?: Record<string, string>
  /** Model ids that should send a `reasoning_effort` field when an effort is set. */
  reasoningModels?: string[]
  /**
   * Optional hook to turn the stored key into the actual bearer token. Used by
   * GitHub Copilot, which exchanges a GitHub PAT/OAuth token for a short-lived
   * Copilot token. When absent, the stored key is sent as the bearer directly.
   */
  resolveBearer?: (apiKey: string, signal?: AbortSignal) => Promise<string>
}

/** One SSE line's parsed delta shape (only the fields we read). */
interface ChatCompletionChunk {
  choices?: Array<{ delta?: { content?: string | null } }>
}

/**
 * Parse a single OpenAI-style SSE `data:` payload, returning the text delta it
 * carries (or null when it's `[DONE]`, a keep-alive, or has no content). Pure
 * and exported so the wire-format handling can be unit-tested.
 */
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

/**
 * Stream a chat completion against an OpenAI-style `/chat/completions` endpoint.
 * Returns the assembled text once `[DONE]` (or the stream end) is reached.
 */
async function streamOpenAiCompatible(
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

  // o-series / reasoning models take `reasoning_effort` (low/medium/high) rather
  // than the Anthropic-style output_config. Only send it for declared models.
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

/**
 * One-shot inline completion (issue #82) against the non-streaming
 * `/chat/completions` endpoint. The FIM prefix/suffix go in the user turn and a
 * strict system prompt keeps the reply to raw insertion text. Returns the
 * sanitized `choices[0].message.content`.
 */
async function completeOpenAiCompatible(
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

/** Read the SSE body, accumulating `choices[0].delta.content` until `[DONE]`. */
async function consumeSse(
  body: ReadableStream<Uint8Array>,
  onDelta: (text: string) => void
): Promise<string> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let full = ''

  // Process complete SSE events as they arrive. Events are separated by a blank
  // line; each event has one or more `data:` lines.
  const flushEvent = (raw: string): boolean => {
    // Returns true when a `[DONE]` sentinel was seen (caller should stop).
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
  // Flush any trailing event without a final blank-line separator.
  if (buffer.trim()) flushEvent(buffer)
  return full
}

/** Best-effort read of an error response body for a friendlier message. */
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

/** Build a {@link Provider} from an OpenAI-compatible config. */
export function makeOpenAiCompatibleProvider(config: OpenAiCompatibleConfig): Provider {
  return {
    info: config.info,
    streamChat: (args) => streamOpenAiCompatible(config, args),
    complete: (args) => completeOpenAiCompatible(config, args)
  }
}

// ── Concrete providers ────────────────────────────────────────────────────

/** OpenAI (gpt-4o / gpt-4o-mini / o4-mini). Reasoning effort for the o-series. */
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

/** Grok / xAI (grok-2-latest / grok-2). */
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

/**
 * GitHub Copilot (OpenAI-compatible). Authenticate with a **GitHub personal
 * access token** (fine-grained or classic) or OAuth token on an account with an
 * active Copilot subscription — {@link getCopilotToken} exchanges it for the
 * short-lived Copilot token the chat endpoint actually requires (cached until
 * just before expiry) and adds the integration/editor headers. Still flagged
 * experimental: it can only be verified against a real Copilot account.
 */
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
    keyHint: 'GitHub PAT or OAuth token (needs an active Copilot subscription)',
    keyUrl: 'https://github.com/settings/tokens',
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
