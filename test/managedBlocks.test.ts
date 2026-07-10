import { describe, it, expect } from 'vitest'
import {
  pyLiteral,
  serializeManagedBlocks,
  findManagedBlocks,
  hasManagedBlocks,
  headerInsertIndex,
  writeManagedBlocks,
  MANAGED_SCHEMA_VERSION,
  type ManagedMotion
} from '../src/shared/managed-blocks'

const motion = (over: Partial<ManagedMotion> = {}): ManagedMotion => ({
  poses: { wave: { shoulder: 45, elbow: -20 }, rest: { shoulder: 0, elbow: 0 } },
  sequences: { hello: [['wave', 500], ['rest', 500]] },
  servos: [{ pin: 'GP0', joint: 'shoulder', jointMin: 0, jointMax: 180, servoMin: 0, servoMax: 180 }],
  ...over
})

describe('pyLiteral — literal_eval-safe serialisation (#413)', () => {
  it('emits Python literals for the scalar types', () => {
    expect(pyLiteral(45)).toBe('45')
    expect(pyLiteral(-20.5)).toBe('-20.5')
    expect(pyLiteral(true)).toBe('True')
    expect(pyLiteral(false)).toBe('False')
    expect(pyLiteral(null)).toBe('None')
    expect(pyLiteral(undefined)).toBe('None')
    expect(pyLiteral('wave')).toBe('"wave"')
  })

  it('never emits NaN/Infinity (would break literal_eval) — collapses to 0', () => {
    expect(pyLiteral(NaN)).toBe('0')
    expect(pyLiteral(Infinity)).toBe('0')
    expect(pyLiteral(-0)).toBe('0')
  })

  it('escapes quotes/backslashes/newlines in strings', () => {
    expect(pyLiteral('a"b\\c')).toBe('"a\\"b\\\\c"')
    expect(pyLiteral('line\nbreak')).toBe('"line\\nbreak"')
  })

  it('serialises nested dicts and lists', () => {
    expect(pyLiteral({ shoulder: 45, elbow: -20 })).toBe('{ "shoulder": 45, "elbow": -20 }')
    expect(pyLiteral([['wave', 500]])).toBe('[["wave", 500]]')
  })

  it('drops undefined object fields (keeps the round-trip loss-free)', () => {
    expect(pyLiteral({ pin: 'GP0', invert: undefined })).toBe('{ "pin": "GP0" }')
  })
})

describe('serializeManagedBlocks', () => {
  it('emits both guarded blocks with the current schema version', () => {
    const text = serializeManagedBlocks(motion())
    expect(text).toContain(`# --- snakie:poses v${MANAGED_SCHEMA_VERSION} ---`)
    expect(text).toContain('SNAKIE_POSES = ')
    expect(text).toContain('SNAKIE_SEQUENCES = ')
    expect(text).toContain('# --- snakie:poses:end ---')
    expect(text).toContain(`# --- snakie:servos v${MANAGED_SCHEMA_VERSION} ---`)
    expect(text).toContain('SNAKIE_SERVOS = ')
    expect(text).toContain('# --- snakie:servos:end ---')
  })
})

describe('findManagedBlocks / hasManagedBlocks', () => {
  it('locates well-formed marker pairs with their version', () => {
    const src = serializeManagedBlocks(motion())
    const blocks = findManagedBlocks(src)
    expect(blocks.map((b) => b.name)).toEqual(['poses', 'servos'])
    expect(blocks.every((b) => b.version === MANAGED_SCHEMA_VERSION)).toBe(true)
    expect(hasManagedBlocks(src)).toBe(true)
  })

  it('ignores a dangling open marker with no :end (malformed)', () => {
    const src = '# --- snakie:poses v1 ---\nSNAKIE_POSES = {}\n# nothing closes it'
    expect(findManagedBlocks(src)).toEqual([])
  })

  it('reports no blocks for plain source', () => {
    expect(hasManagedBlocks('print("hi")\n')).toBe(false)
    expect(findManagedBlocks('x = 1\n')).toEqual([])
  })
})

describe('headerInsertIndex', () => {
  it('inserts at the top of an import-only header', () => {
    const lines = ['import time', 'from machine import Pin', '', 'x = 1']
    expect(headerInsertIndex(lines)).toBe(2) // after the two imports
  })

  it('skips a shebang + a module docstring', () => {
    const lines = ['#!/usr/bin/env python3', '"""My robot."""', 'import time', '', 'run()']
    expect(headerInsertIndex(lines)).toBe(3) // after the import
  })

  it('skips a multi-line docstring', () => {
    const lines = ['"""', 'Line one.', 'Line two.', '"""', 'x = 1']
    expect(headerInsertIndex(lines)).toBe(4)
  })

  it('is 0 for a file that starts straight into code', () => {
    expect(headerInsertIndex(['x = 1', 'y = 2'])).toBe(0)
  })
})

describe('writeManagedBlocks — insert', () => {
  it('inserts both blocks into an empty file', () => {
    const { text, inserted, replaced } = writeManagedBlocks('', motion())
    expect(inserted).toEqual(['poses', 'servos'])
    expect(replaced).toEqual([])
    expect(findManagedBlocks(text).map((b) => b.name)).toEqual(['poses', 'servos'])
    expect(text.endsWith('\n')).toBe(true)
  })

  it('inserts after the import header, preserving user code below', () => {
    const src = 'import instruments as inst\n\ndef main():\n    pass\n'
    const { text, inserted } = writeManagedBlocks(src, motion())
    expect(inserted).toEqual(['poses', 'servos'])
    // User code is byte-preserved.
    expect(text).toContain('def main():\n    pass')
    // The block sits after the import, before the function.
    const importAt = text.indexOf('import instruments')
    const blockAt = text.indexOf('# --- snakie:poses')
    const defAt = text.indexOf('def main()')
    expect(importAt).toBeLessThan(blockAt)
    expect(blockAt).toBeLessThan(defAt)
  })
})

describe('writeManagedBlocks — replace only our block', () => {
  const userFile = [
    '"""User robot program."""',
    'import instruments as inst',
    '',
    '# --- snakie:poses v1 --- managed by Snakie Motion Studio',
    'SNAKIE_POSES = { "old": { "j": 1 } }',
    'SNAKIE_SEQUENCES = {}',
    '# --- snakie:poses:end ---',
    '',
    '# my own helper — must survive verbatim',
    'def wiggle():',
    '    inst.servo_on(0).angle(90)  # hand-tuned, do not touch',
    '',
    '# --- snakie:servos v1 --- managed by Snakie Motion Studio',
    'SNAKIE_SERVOS = []',
    '# --- snakie:servos:end ---',
    '',
    'wiggle()',
    ''
  ].join('\n')

  it('rewrites both block bodies and preserves every byte outside them', () => {
    const { text, replaced, inserted } = writeManagedBlocks(userFile, motion())
    expect(replaced.sort()).toEqual(['poses', 'servos'])
    expect(inserted).toEqual([])
    // New data is in.
    expect(text).toContain('"wave"')
    expect(text).toContain('"pin": "GP0"')
    // Old data is gone.
    expect(text).not.toContain('"old"')
    // Everything outside the markers is preserved verbatim.
    expect(text).toContain('"""User robot program."""')
    expect(text).toContain('def wiggle():')
    expect(text).toContain('inst.servo_on(0).angle(90)  # hand-tuned, do not touch')
    expect(text).toContain('# my own helper — must survive verbatim')
    expect(text.trimEnd().endsWith('wiggle()')).toBe(true)
  })

  it('is idempotent — writing the same motion twice yields the same file', () => {
    const once = writeManagedBlocks(userFile, motion()).text
    const twice = writeManagedBlocks(once, motion()).text
    expect(twice).toBe(once)
  })

  it('only touches the block that exists; inserts the missing one', () => {
    const onlyServos = [
      'import instruments as inst',
      '',
      '# --- snakie:servos v1 ---',
      'SNAKIE_SERVOS = []',
      '# --- snakie:servos:end ---',
      ''
    ].join('\n')
    const { replaced, inserted } = writeManagedBlocks(onlyServos, motion())
    expect(replaced).toEqual(['servos'])
    expect(inserted).toEqual(['poses'])
  })
})

describe('writeManagedBlocks — schema guard', () => {
  it('leaves a NEWER-version block untouched and reports it skipped', () => {
    const future = [
      '# --- snakie:poses v99 --- from a newer Snakie',
      'SNAKIE_POSES = { "keep": { "me": 1 } }',
      'SNAKIE_SEQUENCES = { "fancy": "new-shape" }',
      '# --- snakie:poses:end ---',
      ''
    ].join('\n')
    const { text, skipped, replaced } = writeManagedBlocks(future, motion())
    expect(skipped).toContain('poses')
    expect(replaced).not.toContain('poses')
    // The future block's contents are preserved byte-for-byte.
    expect(text).toContain('"keep": { "me": 1 }')
    expect(text).toContain('"fancy": "new-shape"')
    // The servos block (absent) is still inserted at the known version.
    expect(text).toContain(`# --- snakie:servos v${MANAGED_SCHEMA_VERSION} ---`)
  })
})

describe('writeManagedBlocks — newline handling', () => {
  it('preserves CRLF line endings', () => {
    const src = 'import time\r\n\r\nx = 1\r\n'
    const { text } = writeManagedBlocks(src, motion())
    expect(text.includes('\r\n')).toBe(true)
    expect(text.includes('\n\n')).toBe(false) // no bare LF crept in
    expect(text).toContain('x = 1')
  })

  it('does not add a trailing newline to a file that lacked one', () => {
    const src = 'x = 1'
    const { text } = writeManagedBlocks(src, motion())
    expect(text.endsWith('\n')).toBe(false)
  })
})
