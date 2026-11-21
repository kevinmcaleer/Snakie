import { describe, expect, it } from 'vitest'
import { queueInstall } from '../src/renderer/src/hooks/useInstallWhenConnected'

describe('queueInstall', () => {
  it('adds a key once, however often Install is pressed', () => {
    const once = queueInstall([], 'ssd1306')
    expect(once).toEqual(['ssd1306'])
    expect(queueInstall(once, 'ssd1306')).toEqual(['ssd1306'])
  })

  it('keeps the order things were asked for', () => {
    expect(queueInstall(['ssd1306'], 'bme280')).toEqual(['ssd1306', 'bme280'])
  })

  it('does not change the list it was given', () => {
    const before = ['ssd1306']
    queueInstall(before, 'bme280')
    expect(before).toEqual(['ssd1306'])
  })
})
