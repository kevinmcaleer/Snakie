import { describe, it, expect } from 'vitest'
import { parseOutline } from '../src/renderer/src/components/OutlinePanel'

describe('parseOutline', () => {
  it('returns no symbols for empty / whitespace-only input', () => {
    expect(parseOutline('')).toEqual([])
    expect(parseOutline('\n\n   \n')).toEqual([])
  })

  it('extracts a top-level function with its signature and 1-based line', () => {
    const out = parseOutline('def foo(a, b):\n    return a + b\n')
    expect(out).toEqual([{ kind: 'function', name: 'foo', line: 1, detail: '(a, b)' }])
  })

  it('extracts async functions', () => {
    const out = parseOutline('async def main():\n    pass\n')
    expect(out).toEqual([{ kind: 'function', name: 'main', line: 1, detail: '()' }])
  })

  it('extracts a class with base classes as detail', () => {
    const out = parseOutline('class Foo(Bar, Baz):\n    pass\n')
    expect(out).toEqual([{ kind: 'class', name: 'Foo', line: 1, detail: '(Bar, Baz)' }])
  })

  it('omits detail for a class with no bases', () => {
    const out = parseOutline('class Foo:\n    pass\n')
    expect(out).toEqual([{ kind: 'class', name: 'Foo', line: 1, detail: undefined }])
  })

  it('extracts module-level assignments', () => {
    const out = parseOutline('X = 1\nY: int = 2\n')
    expect(out).toEqual([
      { kind: 'variable', name: 'X', line: 1 },
      { kind: 'variable', name: 'Y', line: 2 }
    ])
  })

  it('ignores comparison operators (== and <=) as assignments', () => {
    // These start at column 0 but are not assignments.
    const out = parseOutline('x == 1\ny <= 2\n')
    expect(out).toEqual([])
  })

  it('ignores indented members (methods, locals)', () => {
    const src = ['class Foo:', '    def method(self):', '        local = 1', 'TOP = 2'].join('\n')
    const out = parseOutline(src)
    expect(out).toEqual([
      { kind: 'class', name: 'Foo', line: 1, detail: undefined },
      { kind: 'variable', name: 'TOP', line: 4 }
    ])
  })

  it('ignores comment lines', () => {
    expect(parseOutline('# def notreal():\nA = 1')).toEqual([
      { kind: 'variable', name: 'A', line: 2 }
    ])
  })

  it('dedupes repeated variable assignments, keeping the first line', () => {
    const out = parseOutline('count = 0\ncount = 1\ncount = 2\n')
    expect(out).toEqual([{ kind: 'variable', name: 'count', line: 1 }])
  })

  it('handles CRLF line endings', () => {
    const out = parseOutline('def a():\r\n    pass\r\nB = 1\r\n')
    expect(out).toEqual([
      { kind: 'function', name: 'a', line: 1, detail: '()' },
      { kind: 'variable', name: 'B', line: 3 }
    ])
  })

  it('handles a mixed module in order', () => {
    const src = ['import os', 'CONFIG = {}', 'def setup():', '    pass', 'class App:', '    pass'].join(
      '\n'
    )
    const out = parseOutline(src)
    expect(out).toEqual([
      { kind: 'variable', name: 'CONFIG', line: 2 },
      { kind: 'function', name: 'setup', line: 3, detail: '()' },
      { kind: 'class', name: 'App', line: 5, detail: undefined }
    ])
  })

  it('treats multi-target assignment by recording the first target', () => {
    const out = parseOutline('a = b = 0\n')
    expect(out).toEqual([{ kind: 'variable', name: 'a', line: 1 }])
  })
})
