import { describe, it, expect } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { I2cGrid } from '../src/renderer/src/components/I2cDetectInstrument'
import { buildI2cGrid } from '../src/renderer/src/components/scanner-logic'

/**
 * Scan-sweep playback (#218): the grid renders three phases as the cursor
 * (a flat 0..127 address index) crosses it —
 *   ahead of the cursor  → dim `--unswept` cells,
 *   at the cursor        → one bright `--cursor` cell,
 *   behind the cursor    → revealed cells; detected ones get `--on --ping`
 *                          (the water-ripple runs on the ping class).
 */
const grid = buildI2cGrid([0x3c, 0x68])

const render = (sweep: number | null): string =>
  renderToStaticMarkup(createElement(I2cGrid, { grid, sweep }))

describe('I2C scan sweep (#218)', () => {
  it('sweep=null (idle/finished): everything revealed, both addresses ping', () => {
    const html = render(null)
    expect(html).not.toContain('i2cdet__cell--cursor')
    expect(html).not.toContain('i2cdet__cell--unswept')
    expect(html.match(/i2cdet__cell--on i2cdet__cell--ping/g)?.length).toBe(2)
    expect(html).toContain('>3C<')
    expect(html).toContain('>68<')
  })

  it('mid-sweep before any hit: a cursor cell, detected cells still hidden', () => {
    const html = render(20) // cursor at 0x14, before 0x3C
    expect(html.match(/i2cdet__cell--cursor/g)?.length).toBe(1)
    expect(html).not.toContain('i2cdet__cell--on')
    expect(html).not.toContain('>3C<')
    // Everything past the cursor is dim: 128 − 20 swept − 1 cursor = 107.
    expect(html.match(/i2cdet__cell--unswept/g)?.length).toBe(107)
  })

  it('mid-sweep after crossing 0x3C: that address pings, 0x68 still hidden', () => {
    const html = render(0x50)
    expect(html.match(/i2cdet__cell--on i2cdet__cell--ping/g)?.length).toBe(1)
    expect(html).toContain('>3C<')
    expect(html).not.toContain('>68<')
    expect(html.match(/i2cdet__cell--cursor/g)?.length).toBe(1)
  })

  it('cursor exactly on a detected cell: cursor shows, reveal happens after crossing', () => {
    const html = render(0x3c)
    expect(html.match(/i2cdet__cell--cursor/g)?.length).toBe(1)
    expect(html).not.toContain('>3C<') // revealed only once crossed (addr < sweep)
  })
})
