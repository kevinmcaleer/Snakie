/**
 * Anthropic Claude provider (issue #77).
 *
 * Moved from the old `src/main/llm/client.ts`. Uses the official
 * `@anthropic-ai/sdk` (preferred over hand-rolled fetch). All Anthropic API
 * calls happen HERE, in the main process — the renderer's CSP blocks direct
 * external requests, so the renderer talks to this module over IPC and never
 * sees the API key or the network call.
 *
 * Design choices (see issue #18):
 *  - Default model: `claude-sonnet-4-6`, overridable per request.
 *  - Streaming: yes — we stream text deltas back so the UI feels responsive.
 *  - Effort: applied via `output_config: { effort }` with adaptive thinking,
 *    when the user selects a level (low/medium/high). Never `budget_tokens`.
 *  - Prompt caching: a `cache_control` breakpoint is placed on the (stable)
 *    system prompt and, when present, on the large active-file and console
 *    context blocks, so repeated turns in a conversation re-use the cached
 *    prefix.
 */
import Anthropic from '@anthropic-ai/sdk'
import {
  COMPLETION_SYSTEM_PROMPT,
  SYSTEM_PROMPT,
  activeFileBlock,
  buildCompletionUserPrompt,
  consoleBlock,
  sanitizeCompletion
} from './context'
import type { CompleteArgs, Provider, ProviderInfo, StreamChatArgs } from './types'

/** Default Claude model. */
export const DEFAULT_MODEL = 'claude-sonnet-4-6'

/** Default fast model for inline autocomplete (issue #82). */
export const DEFAULT_COMPLETION_MODEL = 'claude-haiku-4-5'

/** Upper bound on streamed output tokens. */
const MAX_TOKENS = 4096

/** Upper bound on inline-completion output tokens — small + fast (issue #82). */
const COMPLETION_MAX_TOKENS = 64

export const ANTHROPIC_INFO: ProviderInfo = {
  id: 'anthropic',
  label: 'Anthropic Claude',
  models: [
    { id: 'claude-opus-4-8', label: 'Claude Opus 4.8' },
    { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
    { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5' }
  ],
  defaultModel: DEFAULT_MODEL,
  defaultCompletionModel: DEFAULT_COMPLETION_MODEL,
  efforts: ['low', 'medium', 'high'],
  keyHint: 'Anthropic API key (sk-ant-…)',
  keyUrl: 'https://console.anthropic.com/settings/keys'
}

/**
 * Build the system prompt blocks. The base instructions always carry a cache
 * breakpoint; the active-file and console blocks, when present, each carry one
 * too so the whole prefix is reused while those inputs are unchanged.
 */
function buildSystem(context: {
  activeFile?: { name: string; content: string }
  consoleOutput?: string
}): Anthropic.TextBlockParam[] {
  const blocks: Anthropic.TextBlockParam[] = [
    { type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }
  ]
  const file = activeFileBlock(context.activeFile)
  if (file) blocks.push({ type: 'text', text: file, cache_control: { type: 'ephemeral' } })
  const console = consoleBlock(context.consoleOutput)
  if (console) blocks.push({ type: 'text', text: console, cache_control: { type: 'ephemeral' } })
  return blocks
}

async function streamChat(args: StreamChatArgs): Promise<string> {
  const { apiKey, model, effort, messages, context, onDelta, signal } = args
  const client = new Anthropic({ apiKey })

  const apiMessages: Anthropic.MessageParam[] = messages.map((m) => ({
    role: m.role,
    content: m.content
  }))

  // Effort is applied via output_config with adaptive thinking — never
  // budget_tokens (see the claude-api skill). Only the supported levels.
  const body: Anthropic.MessageStreamParams = {
    model: model || DEFAULT_MODEL,
    max_tokens: MAX_TOKENS,
    system: buildSystem(context),
    messages: apiMessages
  }
  if (effort === 'low' || effort === 'medium' || effort === 'high') {
    body.thinking = { type: 'adaptive' }
    body.output_config = { effort }
  }

  let full = ''
  const stream = client.messages.stream(body, { signal })

  stream.on('text', (delta) => {
    full += delta
    onDelta(delta)
  })

  await stream.finalMessage()
  return full
}

/**
 * One-shot inline completion (issue #82). A small, non-streaming
 * `messages.create` on the fast model: the FIM prefix/suffix go in the user
 * turn, and a strict system prompt keeps the reply to raw insertion text.
 */
async function complete(args: CompleteArgs): Promise<string> {
  const { apiKey, model, prefix, suffix, language, signal } = args
  const client = new Anthropic({ apiKey })

  const message = await client.messages.create(
    {
      model: model || DEFAULT_COMPLETION_MODEL,
      max_tokens: COMPLETION_MAX_TOKENS,
      system: COMPLETION_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: buildCompletionUserPrompt({ prefix, suffix, language }) }]
    },
    { signal }
  )

  const text = message.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('')
  return sanitizeCompletion(text)
}

export const anthropicProvider: Provider = {
  info: ANTHROPIC_INFO,
  streamChat,
  complete
}
