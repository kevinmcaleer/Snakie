import { describe, it, expect } from 'vitest'
import {
  BLOCKS_SCHEMA_VERSION,
  blocksFooterVersion,
  hasBlocksFooter,
  hashBlocksCode,
  parseBlocksFooter,
  stripBlocksFooter,
  writeBlocksFooter,
  type BlocksWorkspace
} from '../src/shared/blocks-doc'

/** A workspace shaped like Blockly's serialiser output, big enough to compress. */
const WS: BlocksWorkspace = {
  blocks: {
    languageVersion: 0,
    blocks: [
      {
        type: 'snakie_led_on',
        id: 'aaaaaaaaaaaaaaaaaaaa',
        x: 40,
        y: 40,
        fields: { PIN: '15' },
        next: {
          block: { type: 'snakie_sleep', id: 'bbbbbbbbbbbbbbbbbbbb', fields: { SECS: 0.5 } }
        }
      }
    ]
  },
  variables: [{ name: 'count', id: 'cccccccccccccccccccc' }]
}

const CODE = ['from snakie import Led', 'import time', '', 'led = Led(15)', 'led.on()'].join('\n')

describe('blocks footer round-trip (#1008)', () => {
  it('writes a file that is still ordinary Python above the footer', () => {
    const file = writeBlocksFooter(CODE, WS)
    expect(file.startsWith(`${CODE}\n\n`)).toBe(true)
    expect(file).toContain('# --8<-- snakie-blocks v1 (do not edit below this line)')
    // Every footer line is a comment, so the file runs on the board unmodified.
    const footer = file.slice(file.indexOf('# --8<--')).trimEnd().split('\n')
    expect(footer.every((l) => l.startsWith('#'))).toBe(true)
    // …and the payload block stays inside 80 columns.
    expect(footer.slice(1).every((l) => l.length <= 78)).toBe(true)
  })

  it('reads back the exact code and workspace it was given', () => {
    const doc = parseBlocksFooter(writeBlocksFooter(CODE, WS))
    expect(doc).not.toBeNull()
    expect(doc!.code).toBe(CODE)
    expect(doc!.workspace).toEqual(WS)
    expect(doc!.version).toBe(BLOCKS_SCHEMA_VERSION)
    expect(doc!.codeMatches).toBe(true)
  })

  it('survives a second round-trip byte-for-byte', () => {
    const once = writeBlocksFooter(CODE, WS)
    const doc = parseBlocksFooter(once)!
    expect(writeBlocksFooter(doc.code, doc.workspace)).toBe(once)
  })

  it('compresses a real-sized workspace to a fraction of its JSON', () => {
    // Blockly JSON is extremely repetitive (every block repeats its type, field
    // names and a 20-char id), which is exactly what deflate is good at. A
    // 40-block turtle program is the size that decides whether the footer is a
    // footnote or half the file. Base64 costs 4/3 back, so the win has to clear
    // that before it counts.
    const big: BlocksWorkspace = {
      blocks: {
        languageVersion: 0,
        blocks: Array.from({ length: 40 }, (_, i) => ({
          type: 'snakie_turtle_forward',
          id: `block${String(i).padStart(15, '0')}`,
          fields: { DISTANCE: 100 },
          inputs: { ANGLE: { shadow: { type: 'math_number', fields: { NUM: 90 } } } }
        }))
      }
    }
    const file = writeBlocksFooter(CODE, big)
    const footer = file.slice(file.indexOf('# --8<--')).length
    expect(footer).toBeLessThan(JSON.stringify(big).length / 4)
    // And it still round-trips.
    expect(parseBlocksFooter(file)!.workspace).toEqual(big)
  })

  it('handles an empty program and an empty workspace', () => {
    const doc = parseBlocksFooter(writeBlocksFooter('', {}))
    expect(doc).not.toBeNull()
    expect(doc!.code).toBe('')
    expect(doc!.workspace).toEqual({})
  })

  it('carries non-ASCII through intact (a turtle drawing called "café")', () => {
    const ws = { blocks: { note: 'café — 🐢 ok' } }
    const doc = parseBlocksFooter(writeBlocksFooter('print("héllo")', ws))!
    expect(doc.code).toBe('print("héllo")')
    expect(doc.workspace).toEqual(ws)
  })
})

describe('a plain .py stays plain (#1008)', () => {
  const plain = 'from snakie import Led\n\nLed(15).on()\n'

  it('has no footer', () => {
    expect(hasBlocksFooter(plain)).toBe(false)
    expect(blocksFooterVersion(plain)).toBeNull()
    expect(parseBlocksFooter(plain)).toBeNull()
  })

  it('is returned unchanged by stripBlocksFooter', () => {
    expect(stripBlocksFooter(plain)).toBe(plain)
  })

  it('is not fooled by a file that merely mentions the marker text', () => {
    // A docstring or a raw-Python block (#1018) may legitimately contain it.
    const src = 'HELP = """\n# --8<-- snakie-blocks v1 (do not edit below this line)\n"""\n'
    // The line is inside a string but the parser only reads lines, so it finds
    // the marker — and then finds no payload, which is the safe answer.
    expect(parseBlocksFooter(src)).toBeNull()
  })
})

describe('a footer we cannot read degrades to a plain .py, never a throw (#1008)', () => {
  const file = writeBlocksFooter(CODE, WS)

  it('corrupt base64', () => {
    const broken = file.replace(/\n# [A-Za-z0-9+/=]+/, '\n# !!!! not base64 !!!!')
    expect(() => parseBlocksFooter(broken)).not.toThrow()
    expect(parseBlocksFooter(broken)).toBeNull()
  })

  it('truncated payload', () => {
    const lines = file.split('\n')
    const truncated = `${lines.slice(0, -2).join('\n')}\n`
    expect(parseBlocksFooter(truncated)).toBeNull()
  })

  it('a marker with no payload at all', () => {
    expect(parseBlocksFooter(`${CODE}\n\n# --8<-- snakie-blocks v1\n`)).toBeNull()
  })

  it('a payload that inflates to something that is not our envelope', () => {
    const notOurs = writeBlocksFooter(CODE, WS)
    // Swap in a valid-but-wrong payload: deflate of `[1,2,3]` has no `ws`.
    const doc = parseBlocksFooter(notOurs)!
    const bad = writeBlocksFooter(doc.code, doc.workspace).replace(
      /(# --8<--[^\n]*\n)[\s\S]*/,
      '$1# eJyLNtQxiQUAAyQBIQ==\n'
    )
    expect(parseBlocksFooter(bad)).toBeNull()
  })
})

describe('version skew (#1008)', () => {
  const future = writeBlocksFooter(CODE, WS).replace('snakie-blocks v1', 'snakie-blocks v99')

  it('a newer schema version reads as a plain .py rather than a guess', () => {
    expect(hasBlocksFooter(future)).toBe(false)
    expect(parseBlocksFooter(future)).toBeNull()
  })

  it('but the version is still legible, so the app can say why', () => {
    expect(blocksFooterVersion(future)).toBe(99)
  })

  it('and opening + saving it in Monaco preserves the footer byte-for-byte', () => {
    // Nothing rewrites a file we declined to parse — that is the whole point.
    expect(stripBlocksFooter(future)).not.toBe(future)
    expect(future).toContain('snakie-blocks v99')
  })
})

describe('hand-edit conflict detection (#1008)', () => {
  it('flags Python edited by hand under an unchanged footer', () => {
    const file = writeBlocksFooter(CODE, WS)
    const edited = file.replace('led.on()', 'led.off()  # I changed this')
    const doc = parseBlocksFooter(edited)
    expect(doc).not.toBeNull()
    expect(doc!.codeMatches).toBe(false)
    // The blocks are still readable — the user gets a choice, not a loss.
    expect(doc!.workspace).toEqual(WS)
    expect(doc!.code).toContain('led.off()')
  })

  it('does NOT flag a checkout with CRLF endings', () => {
    const file = writeBlocksFooter(CODE, WS).replace(/\n/g, '\r\n')
    expect(parseBlocksFooter(file)!.codeMatches).toBe(true)
  })

  it('does NOT flag an editor that trims trailing whitespace on save', () => {
    const file = writeBlocksFooter(`${CODE}   `, WS)
    expect(parseBlocksFooter(file)!.codeMatches).toBe(true)
  })

  it('hashes are stable across EOL and trailing-blank-line differences', () => {
    expect(hashBlocksCode('a = 1\nb = 2')).toBe(hashBlocksCode('a = 1\r\nb = 2\n\n'))
    expect(hashBlocksCode('a = 1')).not.toBe(hashBlocksCode('a = 2'))
  })
})

describe('stripBlocksFooter — keep the code, drop the blocks (#1008, #1016)', () => {
  it('leaves a runnable .py with no trace of the footer', () => {
    const plain = stripBlocksFooter(writeBlocksFooter(CODE, WS))
    expect(plain).toBe(`${CODE}\n`)
    expect(hasBlocksFooter(plain)).toBe(false)
  })
})
