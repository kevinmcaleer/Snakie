/**
 * The provider abstraction (issue #77).
 *
 * Every LLM backend (Anthropic Claude, OpenAI, Google Gemini, Grok/xAI, GitHub
 * Copilot) implements the {@link Provider} interface: a static {@link ProviderInfo}
 * describing its models + knobs, and a `streamChat` that runs a streaming
 * completion in the MAIN process (the renderer CSP blocks external requests).
 *
 * All network calls happen here, in main. The renderer only ever talks to the
 * `llm:*` IPC handlers, which route to the selected provider.
 */
import type { LlmMessage, LlmProviderInfo } from '../types'

/** Static, renderer-safe description of a provider. Same shape as {@link LlmProviderInfo}. */
export type ProviderInfo = LlmProviderInfo

/** The editor/console context attached to a chat request. */
export interface ChatContext {
  /** The active editor file, when the user opted to include it. */
  activeFile?: { name: string; content: string }
  /** Recent console/REPL output since the last Run, when attached (issue #78). */
  consoleOutput?: string
}

/** Arguments to {@link Provider.streamChat}. */
export interface StreamChatArgs {
  /** The provider API key / token (never logged). */
  apiKey: string
  /** Model id to use (already defaulted by the registry layer). */
  model: string
  /** Reasoning-effort level, when the provider supports it. */
  effort?: string
  /** Speed/latency tier, when the provider supports it. */
  speed?: string
  /** The conversation so far (oldest first). */
  messages: LlmMessage[]
  /** Editor/console context to fold into the request. */
  context: ChatContext
  /** Called with each text delta as it streams in. */
  onDelta: (text: string) => void
  /** Optional abort signal to cancel the request. */
  signal?: AbortSignal
}

/**
 * Arguments to {@link Provider.complete} — a one-shot, non-streaming inline
 * completion (issue #82). FIM-style: the model fills in the text that belongs at
 * the cursor, given the code before (`prefix`) and after (`suffix`) it.
 */
export interface CompleteArgs {
  /** The provider API key / token (never logged). */
  apiKey: string
  /** The fast completion model id to use (already defaulted by the IPC layer). */
  model: string
  /** Code immediately before the cursor (bounded by the caller). */
  prefix: string
  /** Code immediately after the cursor (bounded by the caller). */
  suffix: string
  /** Editor language id (e.g. `python`), to steer the completion. */
  language: string
  /** Optional abort signal to cancel an in-flight request (new keystrokes). */
  signal?: AbortSignal
}

/** A pluggable LLM backend. */
export interface Provider {
  /** Static, renderer-safe metadata. */
  readonly info: ProviderInfo
  /**
   * Stream a completion, invoking `onDelta` for each text chunk. Resolves with
   * the full assembled text once the stream ends. Throws on API errors (the IPC
   * layer translates these into a serializable error result).
   */
  streamChat(args: StreamChatArgs): Promise<string>
  /**
   * One-shot inline code completion (issue #82). Returns ONLY the text to insert
   * at the cursor — no markdown fences, no prose. Uses a small, fast model (low
   * `max_tokens`) so it can run on every typing pause without spending much.
   * Throws on API errors; the caller treats a throw/abort as "no suggestion".
   */
  complete(args: CompleteArgs): Promise<string>
}
