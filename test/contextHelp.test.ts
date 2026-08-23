import { describe, it, expect } from 'vitest'
import {
  languageHelpFor,
  resolveHelpTarget,
  LANGUAGE_HELP
} from '../src/renderer/src/components/context-help'
import { helpTreeFor } from '../src/renderer/src/components/help-content'
import type { Dialect } from '../src/shared/dialect'
import type { PartDefinition } from '../src/shared/part'

const bme: PartDefinition = {
  id: 'bme280',
  name: 'BME280 Breakout',
  headers: [],
  library: { module: 'bme280' }
}
const servo: PartDefinition = {
  id: 'sg90',
  name: 'SG90 Micro Servo',
  headers: [],
  library: { module: 'servo' }
}
const libs = [{ id: 'snakie-standard', parts: [bme, servo] }]

describe('context help resolver (#221)', () => {
  it('resolves an installed part by import module or id (case-insensitive)', () => {
    expect(resolveHelpTarget('bme280', libs)).toEqual({ articleId: 'part-bme280', title: 'BME280 Breakout' })
    expect(resolveHelpTarget('BME280', libs)?.articleId).toBe('part-bme280')
    expect(resolveHelpTarget('servo', libs)?.articleId).toBe('part-sg90') // by module
    expect(resolveHelpTarget('sg90', libs)?.articleId).toBe('part-sg90') // by id
  })
  it('resolves language-reference symbols', () => {
    expect(resolveHelpTarget('Pin', [])?.articleId).toBe('ref-pins')
    expect(resolveHelpTarget('PWM', [])?.articleId).toBe('ref-pwm')
    expect(resolveHelpTarget('I2C', [])?.articleId).toBe('ref-i2c')
    expect(resolveHelpTarget('sleep_ms', [])?.articleId).toBe('ref-timing')
    expect(resolveHelpTarget('print', [])?.articleId).toBe('ref-print')
  })
  it('resolves standard Python keywords, types and built-ins', () => {
    // keywords → control flow / functions / classes / exceptions / imports
    expect(resolveHelpTarget('while', [])?.articleId).toBe('ref-flow')
    expect(resolveHelpTarget('elif', [])?.articleId).toBe('ref-flow')
    expect(resolveHelpTarget('def', [])?.articleId).toBe('ref-functions')
    expect(resolveHelpTarget('return', [])?.articleId).toBe('ref-functions')
    expect(resolveHelpTarget('class', [])?.articleId).toBe('ref-classes')
    expect(resolveHelpTarget('self', [])?.articleId).toBe('ref-classes')
    expect(resolveHelpTarget('try', [])?.articleId).toBe('ref-exceptions')
    expect(resolveHelpTarget('OSError', [])?.articleId).toBe('ref-exceptions')
    expect(resolveHelpTarget('import', [])?.articleId).toBe('ref-imports')
    // types + built-ins
    expect(resolveHelpTarget('dict', [])?.articleId).toBe('ref-types')
    expect(resolveHelpTarget('bytearray', [])?.articleId).toBe('ref-types')
    expect(resolveHelpTarget('None', [])?.articleId).toBe('ref-types')
    expect(resolveHelpTarget('len', [])?.articleId).toBe('ref-builtins')
    expect(resolveHelpTarget('range', [])?.articleId).toBe('ref-builtins')
    expect(resolveHelpTarget('enumerate', [])?.articleId).toBe('ref-builtins')
  })
  it('every language topic maps to a registered help article with content', async () => {
    const { HELP_ARTICLES } = await import('../src/renderer/src/components/help-articles')
    for (const id of new Set(Object.values(LANGUAGE_HELP))) {
      expect((HELP_ARTICLES[id] ?? '').length, id).toBeGreaterThan(100)
    }
  })
  it('parts win over the language table', () => {
    // A hypothetical part whose module collides with a language symbol.
    const pwmPart: PartDefinition = { id: 'pca9685', name: 'PCA9685', headers: [], library: { module: 'pwm' } }
    const r = resolveHelpTarget('pwm', [{ id: 'x', parts: [pwmPart] }])
    expect(r?.articleId).toBe('part-pca9685')
  })
  it('unknown / empty → null', () => {
    expect(resolveHelpTarget('banana', libs)).toBeNull()
    expect(resolveHelpTarget('', libs)).toBeNull()
    expect(resolveHelpTarget(null, libs)).toBeNull()
  })
  it('every language topic points at a real article id', () => {
    for (const id of Object.values(LANGUAGE_HELP)) expect(id).toMatch(/^(ref|gs|cp)-[a-z0-9-]+$/)
  })
})

/**
 * Right-click → "Help for symbol" per runtime (#763, epic #209).
 *
 * The same word is a different page on each Python, and the case that matters
 * most is the word from the WRONG runtime — somebody pasting a MicroPython
 * tutorial into a CircuitPython project.
 */
describe('context help is dialect-aware', () => {
  const DIALECTS: Dialect[] = ['micropython', 'circuitpython', 'unknown']

  it('sends the same word to each runtime’s own page', () => {
    expect(resolveHelpTarget('I2C', [], 'micropython')?.articleId).toBe('ref-i2c')
    expect(resolveHelpTarget('I2C', [], 'circuitpython')?.articleId).toBe('cp-busio')
    expect(resolveHelpTarget('sleep', [], 'micropython')?.articleId).toBe('ref-timing')
    expect(resolveHelpTarget('sleep', [], 'circuitpython')?.articleId).toBe('cp-timing')
  })

  it('resolves the CircuitPython vocabulary that used to resolve to nothing', () => {
    for (const [word, article] of [
      ['digitalio', 'cp-digitalio'],
      ['DigitalInOut', 'cp-digitalio'],
      ['board', 'cp-board'],
      ['AnalogIn', 'cp-analogio'],
      ['PWMOut', 'cp-pwmio'],
      ['try_lock', 'cp-busio'],
      ['monotonic', 'cp-timing'],
      ['remount', 'cp-readonly'],
      ['supervisor', 'cp-code-py']
    ] as const) {
      expect(resolveHelpTarget(word, [], 'circuitpython')?.articleId, word).toBe(article)
    }
  })

  it('redirects a symbol from the other runtime to the page that replaces it', () => {
    // The reason this exists: `machine` on a CircuitPython board is not an
    // unknown word, it is a wrong one, and the reader needs somewhere to go.
    expect(resolveHelpTarget('machine', [], 'circuitpython')?.articleId).toBe('cp-digitalio')
    expect(resolveHelpTarget('sleep_ms', [], 'circuitpython')?.articleId).toBe('cp-timing')
    expect(resolveHelpTarget('duty_u16', [], 'circuitpython')?.articleId).toBe('cp-pwmio')
    expect(resolveHelpTarget('mip', [], 'circuitpython')?.articleId).toBe('cp-libraries')
    // …and the same courtesy in the other direction.
    expect(resolveHelpTarget('digitalio', [], 'micropython')?.articleId).toBe('ref-pins')
    expect(resolveHelpTarget('busio', [], 'micropython')?.articleId).toBe('ref-i2c')
  })

  it('keeps plain Python identical on every runtime', () => {
    for (const word of ['while', 'def', 'class', 'try', 'dict', 'len', 'print']) {
      const ids = DIALECTS.map((d) => resolveHelpTarget(word, [], d)?.articleId)
      expect(new Set(ids).size, `${word} differs per dialect`).toBe(1)
    }
  })

  it('every topic in every runtime’s table is a page that runtime can open', () => {
    // A mapping to an article that the dialect's own tree has pruned would send
    // the reader to a page they cannot get back to from the contents.
    for (const d of DIALECTS) {
      const reachable = new Set(
        (function ids(nodes): string[] {
          return nodes.flatMap((n) => (n.children ? ids(n.children) : [n.id]))
        })(helpTreeFor(d))
      )
      for (const [word, id] of Object.entries(languageHelpFor(d))) {
        expect(reachable.has(id), `${d}: ${word} → ${id} is not in that tree`).toBe(true)
      }
    }
  })

  it('parts still win over the language table, on every runtime', () => {
    const boardPart: PartDefinition = {
      id: 'pico-board',
      name: 'A part called board',
      headers: [],
      library: { module: 'board' }
    }
    for (const d of DIALECTS) {
      expect(resolveHelpTarget('board', [{ id: 'x', parts: [boardPart] }], d)?.articleId).toBe(
        'part-pico-board'
      )
    }
  })
})
