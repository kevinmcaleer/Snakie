import { describe, expect, it } from 'vitest'
import {
  exportSpritePy,
  pyFilename,
  pyModuleName
} from '../src/renderer/src/components/sprite-export'
import { seedSprite } from '../src/renderer/src/components/sprite-seed'
import { newSprite } from '../src/renderer/src/components/sprite-model'

describe('MicroPython module export', () => {
  it('derives a safe python module name and filename', () => {
    expect(pyModuleName(seedSprite())).toBe('blinking_eyes')
    expect(pyFilename(seedSprite())).toBe('blinking_eyes.py')
    expect(pyModuleName(newSprite('8 Ball!'))).toBe('sprite_8_ball')
  })

  it('emits dims, fps, MONO_HLSB frame bytes and the helpers', () => {
    const src = exportSpritePy(seedSprite())
    expect(src).toContain('WIDTH = 12')
    expect(src).toContain('HEIGHT = 8')
    expect(src).toContain('FPS = 8')
    expect(src).toContain('import framebuf')
    expect(src).toContain('framebuf.MONO_HLSB')
    expect(src).toContain('def frame(i):')
    expect(src).toContain('def pixel(i, x, y):')
    expect(src).toContain('def play(display, x=0, y=0, loops=None):')
    // The open-eyes row `.####..####.` packs to 0x79 0xe0.
    expect(src).toContain('\\x79\\xe0')
    // One bytes literal per frame.
    expect(src.match(/b'/g)).toHaveLength(seedSprite().frames.length)
  })

  it('matches the bundled example module byte-for-byte on the frame data', () => {
    // The examples/sprites/blinking_eyes.py literals were generated from the
    // same art — the export path must produce identical frame bytes.
    const src = exportSpritePy(seedSprite())
    expect(src).toContain(
      "b'\\x00\\x00\\x79\\xe0\\x86\\x10\\xb6\\xd0\\xb6\\xd0\\x86\\x10\\x79\\xe0\\x00\\x00'"
    )
    expect(src).toContain(
      "b'\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x79\\xe0\\x00\\x00\\x00\\x00\\x00\\x00'"
    )
  })
})
