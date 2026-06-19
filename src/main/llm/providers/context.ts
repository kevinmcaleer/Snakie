/**
 * Shared context builder (issue #77 + #78).
 *
 * Turns the editor/console {@link ChatContext} into prompt text. Anthropic keeps
 * each piece as its own `cache_control` text block (see `anthropic.ts`); the
 * OpenAI-compatible and Gemini providers fold the same pieces into a single
 * system string. The wording is kept identical across providers so behaviour is
 * consistent regardless of which backend the user picks.
 */
import type { ChatContext } from './types'

/** The frozen base system prompt — kept byte-stable so it caches across requests. */
export const SYSTEM_PROMPT =
  'You are a helpful coding assistant embedded in Snakie, a MicroPython editor ' +
  'for microcontroller boards (Raspberry Pi Pico, ESP32, etc.). Help the user ' +
  'write, debug, and understand MicroPython code. Prefer MicroPython-compatible ' +
  'APIs (the `machine`, `time`, `network` modules and friends) over full CPython ' +
  'libraries that are unavailable on-device. Be concise, and when you show code ' +
  'use fenced code blocks with a language tag.'

/** Build the active-file context block text, or null when there's nothing to add. */
export function activeFileBlock(activeFile?: { name: string; content: string }): string | null {
  if (!activeFile || !activeFile.content.trim()) return null
  return (
    `The user is currently editing a file named "${activeFile.name}". ` +
    `Here are its full contents for context:\n\n` +
    '```python\n' +
    activeFile.content +
    '\n```'
  )
}

/** Build the console-output context block text, or null when there's nothing to add. */
export function consoleBlock(consoleOutput?: string): string | null {
  if (!consoleOutput || !consoleOutput.trim()) return null
  return (
    `Here is the recent console/REPL output from the user's program (since the ` +
    `last time they pressed Run), for context:\n\n` +
    '```\n' +
    consoleOutput.trim() +
    '\n```'
  )
}

/**
 * Fold the base prompt + any context blocks into a single system string. Used by
 * providers that don't have a structured/cached system-block concept (everything
 * except Anthropic).
 */
export function buildSystemString(context: ChatContext): string {
  const parts = [SYSTEM_PROMPT]
  const file = activeFileBlock(context.activeFile)
  if (file) parts.push(file)
  const console = consoleBlock(context.consoleOutput)
  if (console) parts.push(console)
  return parts.join('\n\n')
}

// ── Inline autocomplete (issue #82) ─────────────────────────────────────────

/**
 * The frozen system prompt for one-shot inline completions. Kept byte-stable so
 * it can be prompt-cached, and worded so the model returns ONLY the insertion
 * text (no fences, no prose) — the renderer pastes the raw string at the cursor.
 */
export const COMPLETION_SYSTEM_PROMPT =
  'You are a code completion engine. Return only the code that should be ' +
  'inserted at the cursor — no explanations, no markdown, no code fences. ' +
  'Continue the code naturally and stop at a sensible point.'

/** Args shared by the per-provider completion prompt builders. */
export interface CompletionPromptInput {
  prefix: string
  suffix: string
  language: string
}

/**
 * Build the FIM-style user prompt for an inline completion: the code before the
 * cursor, an explicit `[CURSOR]` marker, then the code after it. Exported (and
 * pure) so the prompt shape can be unit-tested without a network call.
 */
export function buildCompletionUserPrompt({
  prefix,
  suffix,
  language
}: CompletionPromptInput): string {
  return (
    `Complete the ${language || 'code'} at the [CURSOR] marker. ` +
    `Return only the text to insert there.\n\n` +
    `${prefix}[CURSOR]${suffix}`
  )
}

/**
 * Strip anything the model might wrap a completion in despite instructions —
 * leading/trailing markdown code fences and a stray language tag line. Keeps the
 * insertion text clean so it pastes verbatim at the cursor.
 */
export function sanitizeCompletion(text: string): string {
  let out = text
  // Drop a leading ```lang fence (and its newline) plus a trailing ``` fence.
  const fenced = /^\s*```[^\n]*\n([\s\S]*?)\n?```\s*$/.exec(out)
  if (fenced) out = fenced[1]
  return out
}
