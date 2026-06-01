/**
 * Thin wrapper around the official Anthropic SDK for the in-app Claude chat.
 *
 * All Anthropic API calls happen HERE, in the main process — the renderer's CSP
 * blocks direct external requests, so the renderer talks to this module over
 * IPC and never sees the API key or the network call.
 *
 * Design choices (see issue #18):
 *  - SDK: `@anthropic-ai/sdk` (preferred over hand-rolled fetch).
 *  - Default model: `claude-sonnet-4-6`, overridable per request.
 *  - Streaming: yes — we stream text deltas back so the UI feels responsive.
 *  - Prompt caching: a `cache_control` breakpoint is placed on the (stable)
 *    system prompt and, when present, on the large active-file context block,
 *    so repeated turns in a conversation re-use the cached prefix.
 */
import Anthropic from '@anthropic-ai/sdk'
import type { LlmMessage } from './types'

/** Default Claude model. Configurable per request via {@link StreamArgs.model}. */
export const DEFAULT_MODEL = 'claude-sonnet-4-6'

/** Upper bound on streamed output tokens. */
const MAX_TOKENS = 4096

/** The frozen system prompt — kept byte-stable so it caches across requests. */
const SYSTEM_PROMPT =
  'You are a helpful coding assistant embedded in Snakie, a MicroPython editor ' +
  'for microcontroller boards (Raspberry Pi Pico, ESP32, etc.). Help the user ' +
  'write, debug, and understand MicroPython code. Prefer MicroPython-compatible ' +
  'APIs (the `machine`, `time`, `network` modules and friends) over full CPython ' +
  'libraries that are unavailable on-device. Be concise, and when you show code ' +
  'use fenced code blocks with a language tag.'

export interface StreamArgs {
  apiKey: string
  messages: LlmMessage[]
  activeFile?: { name: string; content: string }
  model?: string
  /** Called with each text delta as it streams in. */
  onDelta: (text: string) => void
  /** Optional abort signal to cancel the request. */
  signal?: AbortSignal
}

/**
 * Build the system prompt blocks. When an active file is attached it becomes a
 * second block after the instructions; both carry a cache breakpoint so the
 * whole prefix is reused while the file and instructions are unchanged.
 */
function buildSystem(activeFile?: { name: string; content: string }): Anthropic.TextBlockParam[] {
  const blocks: Anthropic.TextBlockParam[] = [
    { type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }
  ]
  if (activeFile && activeFile.content.trim()) {
    blocks.push({
      type: 'text',
      text:
        `The user is currently editing a file named "${activeFile.name}". ` +
        `Here are its full contents for context:\n\n` +
        '```python\n' +
        activeFile.content +
        '\n```',
      cache_control: { type: 'ephemeral' }
    })
  }
  return blocks
}

/**
 * Stream a Claude completion, invoking `onDelta` for each text chunk. Resolves
 * with the full assembled text once the stream ends. Throws on API errors
 * (the IPC layer translates these into a serializable error result).
 */
export async function streamChat(args: StreamArgs): Promise<string> {
  const { apiKey, messages, activeFile, model, onDelta, signal } = args
  const client = new Anthropic({ apiKey })

  const apiMessages: Anthropic.MessageParam[] = messages.map((m) => ({
    role: m.role,
    content: m.content
  }))

  let full = ''
  const stream = client.messages.stream(
    {
      model: model ?? DEFAULT_MODEL,
      max_tokens: MAX_TOKENS,
      system: buildSystem(activeFile),
      messages: apiMessages
    },
    { signal }
  )

  stream.on('text', (delta) => {
    full += delta
    onDelta(delta)
  })

  await stream.finalMessage()
  return full
}
