/**
 * Shared types for the LLM chat layer. These cross the IPC boundary, so they
 * must be plain, structured-clone-safe data — no class instances.
 *
 * Re-exported through the preload `index.d.ts` so the renderer can import them
 * from the UI-facing surface without reaching into `src/main`.
 *
 * The layer is provider-agnostic (issue #77): a registry of providers
 * (Anthropic Claude, OpenAI, Google Gemini, Grok/xAI, GitHub Copilot) lives in
 * `providers/`, and a request names the `providerId` + `model` it targets.
 */

/** A single chat turn in the conversation thread. */
export interface LlmMessage {
  role: 'user' | 'assistant'
  content: string
}

/**
 * Whether an API key is currently stored for a provider, plus whether this
 * platform can encrypt it at rest. When `secure` is false the key is still
 * persisted but (per Electron `safeStorage`) may be stored in plaintext, so the
 * UI can warn.
 */
export interface LlmKeyStatus {
  /** True when a non-empty key is persisted (for the queried provider). */
  hasKey: boolean
  /** True when OS-backed encryption is available for storage. */
  secure: boolean
}

/** A selectable model offered by a provider. */
export interface LlmModelInfo {
  id: string
  label: string
}

/**
 * Renderer-facing description of a provider: enough for the chat footer to
 * render provider/model/effort/speed dropdowns and the per-provider key
 * settings, without the renderer ever importing the provider implementations.
 */
export interface LlmProviderInfo {
  /** Stable id used as the key-store namespace and in send requests. */
  id: string
  /** Human-readable name shown in the UI. */
  label: string
  /** Selectable models (first is a sensible default fallback). */
  models: LlmModelInfo[]
  /** Default model id when the user hasn't chosen one. */
  defaultModel: string
  /**
   * Default fast model for inline autocomplete (issue #82). Completion reuses
   * the same `models` list for selection, but defaults to this fast, cheap model
   * (e.g. Haiku) rather than the heavier chat default.
   */
  defaultCompletionModel?: string
  /** Reasoning-effort levels the provider supports, if any (e.g. low/medium/high). */
  efforts?: string[]
  /** Speed/latency tiers the provider supports, if any. */
  speeds?: string[]
  /** Short hint about what kind of key/token the provider needs. */
  keyHint?: string
  /** URL where the user can obtain a key (opened externally). */
  keyUrl?: string
  /** When true, the provider is wired but untested / has caveats (e.g. Copilot). */
  experimental?: boolean
}

/** Arguments for a chat completion request. */
export interface LlmSendRequest {
  /** Which provider to route this request to (see {@link LlmProviderInfo.id}). */
  providerId: string
  /** The full conversation so far (oldest first). Last entry is the new user turn. */
  messages: LlmMessage[]
  /**
   * When set, the active editor file is attached as cached context so the model
   * can reason about the code the user is editing.
   */
  activeFile?: { name: string; content: string }
  /**
   * When set, recent console/REPL output (since the last Run) is attached as
   * context so the model can reason about what the program printed (issue #78).
   */
  consoleOutput?: string
  /** Model id to use; falls back to the provider's default when omitted. */
  model?: string
  /** Reasoning-effort level, when the provider declares `efforts`. */
  effort?: string
  /** Speed/latency tier, when the provider declares `speeds`. */
  speed?: string
}

/** A streamed chunk pushed to the renderer during a streaming completion. */
export type LlmStreamEvent =
  | { type: 'start'; requestId: string }
  | { type: 'delta'; requestId: string; text: string }
  | { type: 'done'; requestId: string }
  | { type: 'error'; requestId: string; message: string }

/**
 * Arguments for a one-shot inline completion (issue #82). Non-streaming: the IPC
 * call resolves with the raw text to insert at the cursor. Bounded prefix/suffix
 * give the model FIM context without shipping the whole file each keystroke.
 */
export interface LlmCompleteRequest {
  /** Which provider to route this request to (see {@link LlmProviderInfo.id}). */
  providerId: string
  /** Fast completion model id; falls back to the provider's default when omitted. */
  model?: string
  /** Code immediately before the cursor (bounded by the renderer). */
  prefix: string
  /** Code immediately after the cursor (bounded by the renderer). */
  suffix: string
  /** Editor language id (e.g. `python`), to steer the completion. */
  language: string
}
