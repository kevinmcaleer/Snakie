import { describe, it, expect } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { DataColumnPanel } from '../src/renderer/src/components/DataColumnPanel'
import type { Column } from '../src/renderer/src/components/data-table'

const cols = (...types: Column['type'][]): Column[] =>
  types.map((type, index) => ({ name: `c${index}`, type, index }))

describe('DataColumnPanel render (#276)', () => {
  const columns = cols('number', 'string')
  const rows = [
    ['10', 'ok'],
    ['20', 'ok'],
    ['', 'warm'], // null number → drives a gap %
    ['30', 'cool'],
    ['40', 'ok']
  ]
  const view = [0, 1, 2, 3, 4]

  it('renders a card per column with the type chip', () => {
    const html = renderToStaticMarkup(createElement(DataColumnPanel, { columns, rows, view }))
    expect(html).toContain('Columns')
    expect(html).toContain('dcp__card-type--number')
    expect(html).toContain('dcp__card-type--string')
  })

  it('numeric column draws a histogram + a min/mean/max range', () => {
    const html = renderToStaticMarkup(createElement(DataColumnPanel, { columns, rows, view }))
    expect(html).toContain('dcp__hist')
    expect(html).toContain('dcp__bar')
    expect(html).toContain('μ') // mean marker in the compact range
  })

  it('text column draws frequency bars with the top value', () => {
    const html = renderToStaticMarkup(createElement(DataColumnPanel, { columns, rows, view }))
    expect(html).toContain('dcp__freq')
    expect(html).toContain('distinct')
    expect(html).toContain('ok') // most frequent value
  })

  it('surfaces the gap % for a column with dropped readings', () => {
    const html = renderToStaticMarkup(createElement(DataColumnPanel, { columns, rows, view }))
    // 1 null of 5 → 20% ∅ on the numeric card.
    expect(html).toContain('∅')
    expect(html).toContain('20%')
  })

  it('reflects a FILTERED view (only the given indices are profiled)', () => {
    // Just the two rows with temp 10 and 20 → range 10–20, no gap.
    const html = renderToStaticMarkup(
      createElement(DataColumnPanel, { columns, rows, view: [0, 1] })
    )
    expect(html).toContain('10.00')
    expect(html).toContain('20.00')
    expect(html).not.toContain('40.00')
  })
})
