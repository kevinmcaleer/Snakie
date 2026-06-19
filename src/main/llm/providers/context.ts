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
