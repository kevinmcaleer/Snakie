import { describe, expect, it } from 'vitest'
import {
  buildCompletionUserPrompt,
  sanitizeCompletion
} from '../src/main/llm/providers/context'

/**
 * Unit tests for the inline-completion prompt builder + sanitizer (issue #82).
 * These are the load-bearing, provider-agnostic bits shared by the Anthropic,
 * OpenAI-compatible, and Gemini `complete` implementations: the FIM-style user
 * prompt and the fence-stripping applied to whatever the model returns.
 */
describe('buildCompletionUserPrompt', () => {
  it('places the [CURSOR] marker between prefix and suffix', () => {
    const prompt = buildCompletionUserPrompt({
      prefix: 'def add(a, b):\n    return ',
      suffix: '\n\nprint(add(1, 2))',
      language: 'python'
    })
    expect(prompt).toContain('def add(a, b):\n    return [CURSOR]\n\nprint(add(1, 2))')
    // The language steers the instruction line.
    expect(prompt).toContain('python')
  })

  it('handles an empty suffix (cursor at end of file)', () => {
    const prompt = buildCompletionUserPrompt({
      prefix: 'x = ',
      suffix: '',
      language: 'python'
    })
    expect(prompt).toContain('x = [CURSOR]')
  })

  it('falls back to "code" when no language is given', () => {
    const prompt = buildCompletionUserPrompt({ prefix: 'a', suffix: 'b', language: '' })
    expect(prompt).toContain('code')
    expect(prompt).toContain('a[CURSOR]b')
  })
})

describe('sanitizeCompletion', () => {
  it('returns plain text unchanged', () => {
    expect(sanitizeCompletion('a + b')).toBe('a + b')
  })

  it('strips a wrapping ```lang code fence', () => {
    expect(sanitizeCompletion('```python\na + b\n```')).toBe('a + b')
  })

  it('strips a wrapping bare ``` fence', () => {
    expect(sanitizeCompletion('```\nfoo()\n```')).toBe('foo()')
  })

  it('preserves inner content (including internal newlines)', () => {
    expect(sanitizeCompletion('```python\nfor i in range(3):\n    print(i)\n```')).toBe(
      'for i in range(3):\n    print(i)'
    )
  })

  it('leaves a non-wrapping fence in the middle alone', () => {
    const text = 'before ``` after'
    expect(sanitizeCompletion(text)).toBe(text)
  })
})
