import { describe, it, expect } from 'vitest'
import {
  pyLiteral,
  serializeManagedBlocks,
  findManagedBlocks,
  hasManagedBlocks,
  headerInsertIndex,
  writeManagedBlocks,
  selectManagedMotionFile,
  MANAGED_SCHEMA_VERSION,
  type ManagedMotion,
  type OpenFileLike
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

  it('emits large/tiny finite numbers as literal_eval-readable literals', () => {
    expect(pyLiteral(1e21)).toBe('1e+21')
    expect(pyLiteral(1e-7)).toBe('1e-7')
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
  it('emits a separate guarded block per provided dataset', () => {
    const text = serializeManagedBlocks(motion())
    expect(text).toContain(`# --- snakie:poses v${MANAGED_SCHEMA_VERSION} ---`)
    expect(text).toContain('SNAKIE_POSES = ')
    expect(text).toContain('# --- snakie:poses:end ---')
    expect(text).toContain(`# --- snakie:sequences v${MANAGED_SCHEMA_VERSION} ---`)
    expect(text).toContain('SNAKIE_SEQUENCES = ')
    expect(text).toContain('# --- snakie:sequences:end ---')
    expect(text).toContain(`# --- snakie:servos v${MANAGED_SCHEMA_VERSION} ---`)
    expect(text).toContain('SNAKIE_SERVOS = ')
    expect(text).toContain('# --- snakie:servos:end ---')
  })

  it('emits only the datasets that are provided', () => {
    const text = serializeManagedBlocks({ poses: { a: { j: 1 } } })
    expect(text).toContain('SNAKIE_POSES = ')
    expect(text).not.toContain('SNAKIE_SEQUENCES')
    expect(text).not.toContain('SNAKIE_SERVOS')
  })
})

describe('findManagedBlocks / hasManagedBlocks', () => {
  it('locates well-formed marker pairs with their version', () => {
    const src = serializeManagedBlocks(motion())
    const blocks = findManagedBlocks(src)
    expect(blocks.map((b) => b.name)).toEqual(['poses', 'sequences', 'servos'])
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
  it('inserts after an import-only header', () => {
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

  it('lands after a leading comment run when there is no import header', () => {
    expect(headerInsertIndex(['# My cool robot', '# by Kevin', 'speed = 5'])).toBe(2)
  })
})

describe('writeManagedBlocks — insert', () => {
  it('inserts the provided blocks into an empty file', () => {
    const { text, inserted, replaced } = writeManagedBlocks('', motion())
    expect(inserted).toEqual(['poses', 'sequences', 'servos'])
    expect(replaced).toEqual([])
    expect(findManagedBlocks(text).map((b) => b.name)).toEqual(['poses', 'sequences', 'servos'])
    expect(text.endsWith('\n')).toBe(true)
  })

  it('inserts after the import header, preserving user code below', () => {
    const src = 'import instruments as inst\n\ndef main():\n    pass\n'
    const { text, inserted } = writeManagedBlocks(src, { poses: { a: { j: 1 } }, servos: [] })
    expect(inserted).toEqual(['poses', 'servos'])
    expect(text).toContain('def main():\n    pass')
    const importAt = text.indexOf('import instruments')
    const blockAt = text.indexOf('# --- snakie:poses')
    const defAt = text.indexOf('def main()')
    expect(importAt).toBeLessThan(blockAt)
    expect(blockAt).toBeLessThan(defAt)
  })

  it('does NOT insert a block for a dataset the caller does not manage', () => {
    // No `sequences` field ⇒ no sequences block is ever created.
    const { text, inserted } = writeManagedBlocks('', { poses: {}, servos: [] })
    expect(inserted).toEqual(['poses', 'servos'])
    expect(text).not.toContain('SNAKIE_SEQUENCES')
  })
})

describe('writeManagedBlocks — replace only our block', () => {
  const userFile = [
    '"""User robot program."""',
    'import instruments as inst',
    '',
    '# --- snakie:poses v1 --- managed by Snakie Motion Studio',
    'SNAKIE_POSES = { "old": { "j": 1 } }',
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
    const { text, replaced, inserted } = writeManagedBlocks(userFile, { poses: motion().poses, servos: motion().servos })
    expect(replaced.sort()).toEqual(['poses', 'servos'])
    expect(inserted).toEqual([])
    expect(text).toContain('"wave"')
    expect(text).toContain('"pin": "GP0"')
    expect(text).not.toContain('"old"')
    expect(text).toContain('"""User robot program."""')
    expect(text).toContain('def wiggle():')
    expect(text).toContain('inst.servo_on(0).angle(90)  # hand-tuned, do not touch')
    expect(text).toContain('# my own helper — must survive verbatim')
    expect(text.trimEnd().endsWith('wiggle()')).toBe(true)
  })

  it('is idempotent — writing the same motion twice yields the same file', () => {
    const m = { poses: motion().poses, servos: motion().servos }
    const once = writeManagedBlocks(userFile, m).text
    const twice = writeManagedBlocks(once, m).text
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
    const { replaced, inserted } = writeManagedBlocks(onlyServos, { poses: {}, servos: [] })
    expect(replaced).toEqual(['servos'])
    expect(inserted).toEqual(['poses'])
  })
})

describe('writeManagedBlocks — leave unmanaged datasets alone (#413 review)', () => {
  const withSeq = [
    'import instruments as inst',
    '',
    '# --- snakie:poses v1 ---',
    'SNAKIE_POSES = { "old": {} }',
    '# --- snakie:poses:end ---',
    '# --- snakie:sequences v1 ---',
    'SNAKIE_SEQUENCES = { "handcrafted": [ ["a", 100] ] }',
    '# --- snakie:sequences:end ---',
    ''
  ].join('\n')

  it('preserves a hand-authored sequences block when sequences is not managed', () => {
    // The caller manages poses + servos but NOT sequences (no field) — the
    // existing sequences block must survive a re-export byte-for-byte.
    const { text, replaced } = writeManagedBlocks(withSeq, { poses: { new: {} }, servos: [] })
    expect(replaced).toContain('poses')
    expect(replaced).not.toContain('sequences')
    expect(text).toContain('"handcrafted": [ ["a", 100] ]')
    expect(text).toContain('SNAKIE_POSES = { "new": {  } }')
  })
})

describe('writeManagedBlocks — schema guard', () => {
  it('leaves a NEWER-version block untouched and reports it skipped', () => {
    const future = [
      '# --- snakie:poses v99 --- from a newer Snakie',
      'SNAKIE_POSES = { "keep": { "me": 1 } }',
      '# --- snakie:poses:end ---',
      ''
    ].join('\n')
    const { text, skipped, replaced } = writeManagedBlocks(future, { poses: motion().poses, servos: [] })
    expect(skipped).toContain('poses')
    expect(replaced).not.toContain('poses')
    expect(text).toContain('"keep": { "me": 1 }')
    expect(text).toContain(`# --- snakie:servos v${MANAGED_SCHEMA_VERSION} ---`)
  })
})

describe('writeManagedBlocks — duplicate blocks (#413 review)', () => {
  it('rewrites only the FIRST block of a duplicated name (no doubling)', () => {
    const dup = [
      '# --- snakie:poses v1 ---',
      'SNAKIE_POSES = { "one": {} }',
      '# --- snakie:poses:end ---',
      '# --- snakie:poses v1 ---',
      'SNAKIE_POSES = { "two": {} }',
      '# --- snakie:poses:end ---',
      ''
    ].join('\n')
    const { replaced } = writeManagedBlocks(dup, { poses: { fresh: {} } })
    expect(replaced).toEqual(['poses']) // not ['poses','poses']
  })
})

describe('writeManagedBlocks — newline handling', () => {
  it('preserves a uniform CRLF file', () => {
    const src = 'import time\r\n\r\nx = 1\r\n'
    const { text } = writeManagedBlocks(src, { poses: {} })
    expect(text.includes('\r\n')).toBe(true)
    expect(/[^\r]\n/.test(text)).toBe(false) // no bare LF crept in
    expect(text).toContain('x = 1')
  })

  it('does not add a trailing newline to a file that lacked one', () => {
    const src = 'x = 1'
    const { text } = writeManagedBlocks(src, { poses: {} })
    expect(text.endsWith('\n')).toBe(false)
  })
})

describe('selectManagedMotionFile — the reachable round-trip source (#413 review)', () => {
  const managed = serializeManagedBlocks({ poses: { a: { j: 1 } } })
  const file = (over: Partial<OpenFileLike>): OpenFileLike => ({
    source: 'local',
    name: 'motion.py',
    path: '/proj/motion.py',
    content: managed,
    ...over
  })

  it('picks an in-folder managed motion.py', () => {
    const f = file({})
    expect(selectManagedMotionFile([f], '/proj')).toBe(f)
  })

  it('picks an unsaved in-session buffer (empty path)', () => {
    const f = file({ path: '' })
    expect(selectManagedMotionFile([f], '/proj')).toBe(f)
  })

  it('ignores a motion.py from a DIFFERENT project folder (no cross-project bleed)', () => {
    const f = file({ path: '/other/motion.py' })
    expect(selectManagedMotionFile([f], '/proj')).toBeUndefined()
  })

  it('ignores a motion.py with no managed blocks', () => {
    const f = file({ content: 'print("hi")\n' })
    expect(selectManagedMotionFile([f], '/proj')).toBeUndefined()
  })

  it('ignores a device file', () => {
    const f = file({ source: 'device' })
    expect(selectManagedMotionFile([f], '/proj')).toBeUndefined()
  })
})
