import { describe, expect, it } from 'vitest'
import { parseEmbedParams } from '../src/renderer/src/code-embed/params'
import {
  outputHeight,
  OUTPUT_BAR_H,
  OUTPUT_TERM_H,
  OUTPUT_MESSAGE_H,
  MIN_BOARD_H,
  PIN_CHIPS_H,
  PLOTS_H
} from '../src/renderer/src/code-embed/layout'

/* The lesson runner: a page keeps its own code block and pops this panel up under it. */
describe('the output panel (output=1)', () => {
  it('is off unless asked for', () => {
    expect(parseEmbedParams('?code=print(1)').output).toBe(false)
    expect(parseEmbedParams('?code=print(1)&output=1').output).toBe(true)
    expect(parseEmbedParams('?code=print(1)&output=0').output).toBe(false)
  })

  it('keeps the inline code and its run options', () => {
    const p = parseEmbedParams('?code=print(1)&name=blink.py&output=1&autorun=1&board=pico-plus-2')
    expect(p.source).toEqual({ kind: 'inline', code: 'print(1)', name: 'blink.py' })
    expect(p.autorun).toBe(true)
    expect(p.board).toBe('picoplus2')
  })

  it('is short with no pins, and makes room for the board when there are', () => {
    const plain = outputHeight({})
    expect(plain).toBe(OUTPUT_BAR_H + OUTPUT_TERM_H + 2)
    expect(outputHeight({ board: 'side' })).toBe(OUTPUT_BAR_H + Math.max(MIN_BOARD_H, OUTPUT_TERM_H) + 2)
    expect(outputHeight({ board: 'chips' })).toBe(plain + PIN_CHIPS_H)
    expect(outputHeight({ plots: true })).toBe(plain + PLOTS_H)
    expect(outputHeight({ message: true })).toBe(plain + OUTPUT_MESSAGE_H)
  })
})
