import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { CollapsiblePanel } from '../src/renderer/src/components/CollapsiblePanel'

/**
 * The Soft Shell collapsible primitive (#577) rendered to static HTML — verifies
 * its structure/behaviour without a DOM (vitest runs in node). SSR markup is
 * exactly what the browser mounts.
 */

const html = (node: Parameters<typeof renderToStaticMarkup>[0]): string =>
  renderToStaticMarkup(node)

describe('CollapsiblePanel', () => {
  it('open: renders the body, a ▾ chevron and aria-expanded=true', () => {
    const out = html(
      <CollapsiblePanel title="Files" open onToggle={() => {}}>
        <span>tree</span>
      </CollapsiblePanel>
    )
    expect(out).toContain('aria-expanded="true"')
    expect(out).toContain('▾')
    expect(out).toContain('tree') // body rendered
    expect(out).not.toContain('cpanel--collapsed')
  })

  it('collapsed: drops the body, shows a ▸ chevron and aria-expanded=false', () => {
    const out = html(
      <CollapsiblePanel title="Files" open={false} onToggle={() => {}}>
        <span>tree</span>
      </CollapsiblePanel>
    )
    expect(out).toContain('aria-expanded="false"')
    expect(out).toContain('▸')
    expect(out).toContain('cpanel--collapsed')
    expect(out).not.toContain('tree') // body unmounted
  })

  it('keepMounted: collapsed body stays in the tree but hidden', () => {
    const out = html(
      <CollapsiblePanel title="Console" open={false} keepMounted onToggle={() => {}}>
        <span>scrollback</span>
      </CollapsiblePanel>
    )
    expect(out).toContain('scrollback') // still mounted
    expect(out).toContain('cpanel__body--hidden')
  })

  it('renders a badge after the title', () => {
    const out = html(
      <CollapsiblePanel title="Chain" badge={4} open onToggle={() => {}}>
        <span>x</span>
      </CollapsiblePanel>
    )
    expect(out).toContain('cpanel__badge')
    expect(out).toContain('>4<')
  })

  it('shows actions when open, hides them when collapsed', () => {
    const actions = <button type="button">refresh</button>
    const openOut = html(
      <CollapsiblePanel title="Files" open onToggle={() => {}} actions={actions}>
        <span>x</span>
      </CollapsiblePanel>
    )
    expect(openOut).toContain('cpanel__actions')
    expect(openOut).toContain('refresh')

    const closedOut = html(
      <CollapsiblePanel title="Files" open={false} onToggle={() => {}} actions={actions}>
        <span>x</span>
      </CollapsiblePanel>
    )
    expect(closedOut).not.toContain('cpanel__actions')
    expect(closedOut).not.toContain('refresh')
  })

  it('keeps action buttons OUTSIDE the toggle button (valid markup, no nesting)', () => {
    const out = html(
      <CollapsiblePanel title="Files" open onToggle={() => {}} actions={<button type="button">a</button>}>
        <span>x</span>
      </CollapsiblePanel>
    )
    // The toggle <button> must close before the actions' <button> opens.
    const toggleStart = out.indexOf('cpanel__toggle')
    const toggleClose = out.indexOf('</button>', toggleStart)
    const actionBtn = out.indexOf('>a<')
    expect(toggleClose).toBeLessThan(actionBtn)
  })

  it('passes through class names on the root and body', () => {
    const out = html(
      <CollapsiblePanel title="X" open onToggle={() => {}} className="mine" bodyClassName="rows">
        <span>x</span>
      </CollapsiblePanel>
    )
    expect(out).toMatch(/class="cpanel[^"]*\bmine\b/)
    expect(out).toMatch(/class="cpanel__body[^"]*\brows\b/)
  })
})
