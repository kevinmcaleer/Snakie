import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { ErcBadge, ErcPanel } from '../src/renderer/src/components/ErcPanel'
import { ercSummary, type ErcIssue } from '../src/shared/erc'

/** The ERC badge + issues panel (#601) rendered to static HTML — structure only,
 *  no DOM (vitest runs in node). */
const html = (node: Parameters<typeof renderToStaticMarkup>[0]): string => renderToStaticMarkup(node)

const ISSUES: ErcIssue[] = [
  { rule: 'vcc-gnd-short', severity: 'error', title: 'Power shorted to ground', message: '3V3 is wired directly to GND (node N2).', why: 'A supply tied straight to ground is a dead short.' },
  { rule: 'led-no-resistor', severity: 'warning', title: 'LED has no current-limiting resistor', message: 'LED is wired without a series resistor.', why: 'An LED is a diode; add a resistor.' }
]

describe('ErcBadge', () => {
  it('clean circuit shows a ✓ and the clean modifier', () => {
    const out = html(<ErcBadge summary={ercSummary([])} open={false} onToggle={() => {}} />)
    expect(out).toContain('erc__badge--clean')
    expect(out).toContain('✓')
    expect(out).toContain('no issues')
  })

  it('with issues shows per-severity counts + worst-severity styling', () => {
    const out = html(<ErcBadge summary={ercSummary(ISSUES)} open onToggle={() => {}} />)
    expect(out).toContain('erc__badge--error') // worst severity drives the colour
    expect(out).toContain('erc__badge-count--error')
    expect(out).toContain('erc__badge-count--warning')
    expect(out).toContain('aria-pressed="true"')
  })
})

describe('ErcPanel', () => {
  it('renders each issue with its message AND why-it-matters explainer', () => {
    const out = html(<ErcPanel issues={ISSUES} onClose={() => {}} />)
    expect(out).toContain('Power shorted to ground')
    expect(out).toContain('wired directly to GND')
    expect(out).toContain('Why it matters:')
    expect(out).toContain('erc__row--error')
    expect(out).toContain('erc__row--warning')
  })

  it('empty issues renders the clean state', () => {
    const out = html(<ErcPanel issues={[]} onClose={() => {}} />)
    expect(out).toContain('No electrical issues')
  })
})
