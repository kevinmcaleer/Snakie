/**
 * Google Gemini provider (issue #77).
 *
 * Uses the Gemini REST API directly via global `fetch` (no SDK dependency):
 * `:streamGenerateContent?alt=sse&key=KEY` streams Server-Sent Events. We map
 * the conversation turns to Gemini's `contents` (roles `user` / `model`) plus a
 * `systemInstruction`, and parse the SSE `data:` lines, accumulating
 * `candidates[0].content.parts[].text`.
 *
 * All requests run in the MAIN process (the renderer CSP blocks external
 * requests). The API key is sent only as a query param and is never logged.
 */
import {
  COMPLETION_SYSTEM_PROMPT,
  buildCompletionUserPrompt,
  buildSystemString,
  sanitizeCompletion
} from './context'
import type { CompleteArgs, Provider, ProviderInfo, StreamChatArgs } from './types'

const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta'

/** Upper bound on inline-completion output tokens — small + fast (issue #82). */
const COMPLETION_MAX_TOKENS = 64

export const GEMINI_INFO: ProviderInfo = {
  id: 'gemini',
  label: 'Google Gemini',
  models: [
    { id: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash' },
    { id: 'gemini-1.5-pro', label: 'Gemini 1.5 Pro' }
  ],
  defaultModel: 'gemini-2.0-flash',
  defaultCompletionModel: 'gemini-2.0-flash',
  keyHint: 'Google AI Studio API key',
  keyUrl: 'https://aistudio.google.com/app/apikey'
}

/** Only the fields we read from a streamed chunk. */
interface GeminiChunk {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
}

async function streamChat(args: StreamChatArgs): Promise<string> {
  const { apiKey, model, messages, context, onDelta, signal } = args

  const contents = messages.map((m) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }]
  }))

  const body = {
    contents,
    systemInstruction: { parts: [{ text: buildSystemString(context) }] }
  }

  const url =
    `${BASE_URL}/models/${encodeURIComponent(model)}:streamGenerateContent` +
    `?alt=sse&key=${encodeURIComponent(apiKey)}`

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal
  })

  if (!res.ok || !res.body) {
    const detail = await safeErrorText(res)
    throw new Error(`Gemini request failed (HTTP ${res.status})${detail ? `: ${detail}` : ''}`)
  }

  return await consumeSse(res.body, onDelta)
}

/** Read the SSE body, accumulating candidate part text. */
async function consumeSse(
  body: ReadableStream<Uint8Array>,
  onDelta: (text: string) => void
): Promise<string> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let full = ''

  const flushEvent = (raw: string): void => {
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim()
      if (!trimmed.startsWith('data:')) continue
      const payload = trimmed.slice('data:'.length).trim()
      if (!payload) continue
      try {
        const chunk = JSON.parse(payload) as GeminiChunk
        const parts = chunk.candidates?.[0]?.content?.parts
        if (parts) {
          for (const part of parts) {
            if (part.text) {
              full += part.text
              onDelta(part.text)
            }
          }
        }
      } catch {
        // Ignore non-JSON keep-alive lines.
      }
    }
  }

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let sep: number
    while ((sep = buffer.indexOf('\n\n')) !== -1) {
      const event = buffer.slice(0, sep)
      buffer = buffer.slice(sep + 2)
      flushEvent(event)
    }
  }
  if (buffer.trim()) flushEvent(buffer)
  return full
}

/**
 * One-shot inline completion (issue #82) via the non-streaming
 * `:generateContent` endpoint. The FIM prefix/suffix go in the user turn and a
 * strict `systemInstruction` keeps the reply to raw insertion text. Returns the
 * sanitized first candidate's joined part text.
 */
async function complete(args: CompleteArgs): Promise<string> {
  const { apiKey, model, prefix, suffix, language, signal } = args

  const body = {
    contents: [
      {
        role: 'user',
        parts: [{ text: buildCompletionUserPrompt({ prefix, suffix, language }) }]
      }
    ],
    systemInstruction: { parts: [{ text: COMPLETION_SYSTEM_PROMPT }] },
    generationConfig: { maxOutputTokens: COMPLETION_MAX_TOKENS }
  }

  const url =
    `${BASE_URL}/models/${encodeURIComponent(model)}:generateContent` +
    `?key=${encodeURIComponent(apiKey)}`

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal
  })

  if (!res.ok) {
    const detail = await safeErrorText(res)
    throw new Error(`Gemini completion failed (HTTP ${res.status})${detail ? `: ${detail}` : ''}`)
  }

  const json = (await res.json()) as GeminiChunk
  const text = (json.candidates?.[0]?.content?.parts ?? [])
    .map((p) => p.text ?? '')
    .join('')
  return sanitizeCompletion(text)
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

export const geminiProvider: Provider = {
  info: GEMINI_INFO,
  streamChat,
  complete
}
