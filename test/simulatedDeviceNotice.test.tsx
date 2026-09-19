import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { SimulatedDeviceNotice } from '../src/renderer/src/components/SimulatedDeviceNotice'

/**
 * The simulated-device callout rendered to static HTML (#1163) — vitest runs in
 * node, and SSR markup is what the browser mounts.
 *
 * The assertions that matter are the ones about what it SAYS. The whole notice
 * exists because "Disconnect first" is the step nobody guesses, so someone
 * softening this copy should have to update a test.
 */
const render = (over: Partial<Parameters<typeof SimulatedDeviceNotice>[0]> = {}): string =>
  renderToStaticMarkup(
    <SimulatedDeviceNotice onDisconnect={() => {}} onDismiss={() => {}} {...over} />
  )

describe('SimulatedDeviceNotice (#1163)', () => {
  it('names the simulated device and the way off it', () => {
    const html = render()
    expect(html).toContain('simulated device')
    expect(html).toContain('<strong>Disconnect</strong>')
    // And WHY the dropdown will not open, which is the part that looks broken.
    expect(html).toContain('locked while a')
  })

  it('offers Disconnect as an action, not just as advice', () => {
    expect(render()).toContain('>Disconnect<')
  })

  it('disables the action while a connect/disconnect is in flight', () => {
    expect(render({ busy: true })).toContain('disabled')
    expect(render({ busy: false })).not.toContain('disabled')
  })

  it('is announced politely and can be dismissed', () => {
    const html = render()
    expect(html).toContain('role="status"')
    expect(html).toContain('aria-live="polite"')
    expect(html).toContain('aria-label="Dismiss this notice"')
    expect(html).toContain('>Got it<')
  })
})
