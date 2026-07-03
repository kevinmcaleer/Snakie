import { describe, it, expect } from 'vitest'
import { resolveHelpTarget, LANGUAGE_HELP } from '../src/renderer/src/components/context-help'
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
  it('every language topic points at a real ref-article id', () => {
    for (const id of Object.values(LANGUAGE_HELP)) expect(id).toMatch(/^ref-[a-z0-9]+$/)
  })
})
