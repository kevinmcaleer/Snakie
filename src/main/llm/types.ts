/**
 * Shared types for the LLM (Claude) chat layer. These cross the IPC boundary,
 * so they must be plain, structured-clone-safe data — no class instances.
 *
 * Re-exported through the preload `index.d.ts` so the renderer can import them
 * from the UI-facing surface without reaching into `src/main`.
 */

/** A single chat turn in the conversation thread. */
export interface LlmMessage {
  role: 'user' | 'assistant'
  content: string
}

/**
 * Whether an Anthropic API key is currently stored, plus whether this platform
 * can encrypt it at rest. When `secure` is false the key is still persisted but
 * (per Electron `safeStorage`) may be stored in plaintext, so the UI can warn.
 */
export interface LlmKeyStatus {
  /** True when a non-empty key is persisted. */
  hasKey: boolean
  /** True when OS-backed encryption is available for storage. */
  secure: boolean
}

/** Arguments for a chat completion request. */
export interface LlmSendRequest {
  /** The full conversation so far (oldest first). Last entry is the new user turn. */
  messages: LlmMessage[]
  /**
   * When set, the active editor file is attached as cached context so Claude
   * can reason about the code the user is editing.
   */
  activeFile?: { name: string; content: string }
  /** Override the default model for this request. */
  model?: string
}

/** A streamed chunk pushed to the renderer during a streaming completion. */
export type LlmStreamEvent =
  | { type: 'start'; requestId: string }
  | { type: 'delta'; requestId: string; text: string }
  | { type: 'done'; requestId: string }
  | { type: 'error'; requestId: string; message: string }
