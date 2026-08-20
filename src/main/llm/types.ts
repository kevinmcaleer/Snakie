export interface LlmMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface LlmKeyStatus {
  hasKey: boolean
  secure: boolean
}

export interface LlmModelInfo {
  id: string
  label: string
}

export interface LlmProviderInfo {
  id: string
  label: string
  models: LlmModelInfo[]
  defaultModel: string
  defaultCompletionModel?: string
  efforts?: string[]
  speeds?: string[]
  keyHint?: string
  keyUrl?: string
  experimental?: boolean
  /** When true, the user can type any model name instead of picking from a list. */
  customModel?: boolean
}

export interface LlmSendRequest {
  providerId: string
  messages: LlmMessage[]
  activeFile?: { name: string; content: string }
  consoleOutput?: string
  model?: string
  effort?: string
  speed?: string
}

export type LlmStreamEvent =
  | { type: 'start'; requestId: string }
  | { type: 'delta'; requestId: string; text: string }
  | { type: 'done'; requestId: string }
  | { type: 'error'; requestId: string; message: string }

export interface LlmCompleteRequest {
  providerId: string
  model?: string
  prefix: string
  suffix: string
  language: string
}
