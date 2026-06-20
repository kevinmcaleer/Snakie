import { describe, expect, it } from 'vitest'
import {
  autofixFormat,
  autofixJson,
  autofixYaml,
  formatKindForName,
  jsonErrorLineCol,
  jsonErrorOffset,
  offsetToLineCol,
  stripJsonNoise,
  validateFormat
} from '../src/renderer/src/components/format-validate'

/**
 * Unit tests for the pure JSON/YAML validator + autofix (issue #93). No Monaco,
 * React or DOM — just the parse/position/fix logic the editor + Problems panel
 * call into.
 */

describe('formatKindForName', () => {
  it('classifies json / yml / yaml, case-insensitively', () => {
    expect(formatKindForName('config.json')).toBe('json')
    expect(formatKindForName('CONFIG.JSON')).toBe('json')
    expect(formatKindForName('app.yml')).toBe('yaml')
    expect(formatKindForName('app.yaml')).toBe('yaml')
    expect(formatKindForName('App.YAML')).toBe('yaml')
  })

  it('returns null for unsupported extensions', () => {
    expect(formatKindForName('main.py')).toBeNull()
    expect(formatKindForName('readme.md')).toBeNull()
    expect(formatKindForName('notes.txt')).toBeNull()
    expect(formatKindForName('noext')).toBeNull()
  })
})

describe('offsetToLineCol', () => {
  it('maps a char offset to 1-based line/column', () => {
    const text = 'a\nbb\nccc'
    expect(offsetToLineCol(text, 0)).toEqual({ line: 1, column: 1 })
    expect(offsetToLineCol(text, 2)).toEqual({ line: 2, column: 1 }) // first 'b'
    expect(offsetToLineCol(text, 5)).toEqual({ line: 3, column: 1 }) // first 'c'
  })

  it('clamps out-of-range offsets', () => {
    expect(offsetToLineCol('abc', 999)).toEqual({ line: 1, column: 4 })
    expect(offsetToLineCol('abc', -5)).toEqual({ line: 1, column: 1 })
  })
})

describe('json error position parsing', () => {
  it('extracts a char offset from a "position N" message', () => {
    expect(jsonErrorOffset('Unexpected token } in JSON at position 17')).toBe(17)
    expect(jsonErrorOffset('no position here')).toBeNull()
  })

  it('extracts a line/column pair when present', () => {
    expect(jsonErrorLineCol('Unexpected end of JSON input at line 3 column 5')).toEqual({
      line: 3,
      column: 5
    })
    expect(jsonErrorLineCol('Unexpected token at position 4')).toBeNull()
  })
})

describe('validateFormat — unsupported extensions', () => {
  it('returns [] for files this module does not handle', () => {
    expect(validateFormat('main.py', 'def x(:')).toEqual([])
    expect(validateFormat('notes.md', 'not: valid: yaml: [')).toEqual([])
  })
})

describe('validateFormat — JSON', () => {
  it('returns [] for valid JSON', () => {
    expect(validateFormat('a.json', '{"a": 1, "b": [1, 2, 3]}')).toEqual([])
  })

  it('treats empty / whitespace content as valid (nothing to validate)', () => {
    expect(validateFormat('a.json', '')).toEqual([])
    expect(validateFormat('a.json', '   \n  ')).toEqual([])
  })

  it('reports invalid JSON with a position-derived line/column', () => {
    // Missing value after the comma -> parse error somewhere on line 3.
    const content = '{\n  "a": 1,\n  "b":\n}'
    const diags = validateFormat('a.json', content)
    expect(diags).toHaveLength(1)
    expect(diags[0].severity).toBe('error')
    expect(diags[0].source).toBe('json')
    expect(diags[0].message).toMatch(/Invalid JSON/)
    expect(diags[0].line).toBeGreaterThanOrEqual(1)
    expect(diags[0].column).toBeGreaterThanOrEqual(1)
  })

  it('attaches a format autofix to the diagnostic when the JSON is recoverable', () => {
    // Trailing comma is recoverable by stripJsonNoise, so a fix is offered.
    const diags = validateFormat('a.json', '{\n  "a": 1,\n}')
    expect(diags).toHaveLength(1)
    expect(diags[0].fixes).toBeDefined()
    expect(diags[0].fixes?.[0].edit.newText).toMatch(/"a": 1/)
    // The offered fix must itself be valid JSON.
    expect(() => JSON.parse(diags[0].fixes![0].edit.newText)).not.toThrow()
  })
})

describe('validateFormat — YAML', () => {
  it('returns [] for valid YAML', () => {
    expect(validateFormat('a.yaml', 'name: test\nlist:\n  - 1\n  - 2\n')).toEqual([])
    expect(validateFormat('a.yml', 'a: 1')).toEqual([])
  })

  it('reports invalid YAML with the engine line/column', () => {
    // A tab used for indentation is a hard YAML error with a position.
    const content = 'a:\n\t- 1\n'
    const diags = validateFormat('a.yaml', content)
    expect(diags.length).toBeGreaterThanOrEqual(1)
    const err = diags.find((d) => d.severity === 'error')
    expect(err).toBeDefined()
    expect(err!.source).toBe('yaml')
    expect(err!.message).toMatch(/Invalid YAML/)
    expect(err!.line).toBeGreaterThanOrEqual(1)
    expect(err!.column).toBeGreaterThanOrEqual(1)
  })

  it('reports a duplicate-key error with a position', () => {
    const diags = validateFormat('a.yaml', 'a: 1\nb: 2\na: 3\n')
    expect(diags.length).toBeGreaterThanOrEqual(1)
    expect(diags[0].source).toBe('yaml')
    // The duplicate is on line 3.
    expect(diags.some((d) => d.line === 3)).toBe(true)
  })
})

describe('stripJsonNoise', () => {
  it('drops a trailing comma before } and ]', () => {
    expect(stripJsonNoise('{"a": 1,}')).toBe('{"a": 1}')
    expect(stripJsonNoise('[1, 2,]')).toBe('[1, 2]')
  })

  it('strips // line and /* */ block comments outside strings', () => {
    expect(stripJsonNoise('{ "a": 1 // note\n}')).toMatch(/"a": 1/)
    expect(stripJsonNoise('{ "a": 1 // note\n}')).not.toMatch(/note/)
    expect(stripJsonNoise('{ /* hi */ "a": 1 }')).not.toMatch(/hi/)
  })

  it('leaves // and commas that live inside strings untouched', () => {
    const src = '{ "url": "http://x", "csv": "1,2," }'
    expect(stripJsonNoise(src)).toBe(src)
  })
})

describe('autofixJson', () => {
  it('pretty-prints valid-but-unformatted JSON', () => {
    const fixed = autofixJson('{"a":1,"b":2}')
    expect(fixed).toBe('{\n  "a": 1,\n  "b": 2\n}\n')
  })

  it('returns null when already canonical (nothing to do)', () => {
    expect(autofixJson('{\n  "a": 1\n}\n')).toBeNull()
  })

  it('repairs trailing commas + comments, returning valid JSON', () => {
    const fixed = autofixJson('{\n  "a": 1, // trailing\n}')
    expect(fixed).not.toBeNull()
    expect(() => JSON.parse(fixed!)).not.toThrow()
    expect(JSON.parse(fixed!)).toEqual({ a: 1 })
  })

  it('returns null when the JSON cannot be recovered', () => {
    expect(autofixJson('{ this is not json at all ')).toBeNull()
  })
})

describe('autofixYaml', () => {
  it('canonicalises valid YAML', () => {
    const fixed = autofixYaml('a:    1\nb:    2')
    expect(fixed).not.toBeNull()
    expect(fixed).toMatch(/a: 1/)
    expect(fixed).toMatch(/b: 2/)
  })

  it('returns null for invalid YAML (no safe fix)', () => {
    expect(autofixYaml('a:\n\t- 1\n')).toBeNull()
  })

  it('returns null when already canonical', () => {
    expect(autofixYaml('a: 1\n')).toBeNull()
  })
})

describe('autofixFormat dispatch', () => {
  it('routes by extension and returns null for unsupported files', () => {
    expect(autofixFormat('x.json', '{"a":1}')).toBe('{\n  "a": 1\n}\n')
    expect(autofixFormat('x.yaml', 'a:   1')).toMatch(/a: 1/)
    expect(autofixFormat('x.py', 'print(1)')).toBeNull()
  })
})
