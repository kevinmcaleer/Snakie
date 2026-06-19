import { describe, expect, it } from 'vitest'
import { parseOpenAiSsePayload } from '../src/main/llm/providers/openaiCompatible'

/**
 * Unit tests for the OpenAI-compatible SSE payload parser (issue #77). This is
 * the load-bearing wire-format bit shared by the OpenAI, Grok/xAI, and GitHub
 * Copilot providers: each streamed `data:` line carries a chat-completion chunk
 * whose `choices[0].delta.content` is the next text fragment.
 */
describe('parseOpenAiSsePayload', () => {
  it('extracts the delta content from a chunk', () => {
    const payload = JSON.stringify({ choices: [{ delta: { content: 'Hello' } }] })
    expect(parseOpenAiSsePayload(payload)).toBe('Hello')
  })

  it('returns null for the [DONE] sentinel', () => {
    expect(parseOpenAiSsePayload('[DONE]')).toBeNull()
  })

  it('returns null for an empty payload (keep-alive)', () => {
    expect(parseOpenAiSsePayload('')).toBeNull()
    expect(parseOpenAiSsePayload('   ')).toBeNull()
  })

  it('returns null when the chunk has no content delta (e.g. role-only opener)', () => {
    const payload = JSON.stringify({ choices: [{ delta: { role: 'assistant' } }] })
    expect(parseOpenAiSsePayload(payload)).toBeNull()
  })

  it('returns null for a malformed/non-JSON payload', () => {
    expect(parseOpenAiSsePayload('not json {')).toBeNull()
  })

  it('preserves whitespace inside the delta content', () => {
    const payload = JSON.stringify({ choices: [{ delta: { content: ' world\n' } }] })
    expect(parseOpenAiSsePayload(payload)).toBe(' world\n')
  })
})
