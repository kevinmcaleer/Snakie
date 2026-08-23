import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels'

/**
 * THE INSPECT PANEL SCROLLS (#796).
 *
 * The symbol list ran off the bottom of its pane with no way to reach the rest.
 * The cause was not a missing `overflow` — one was there, on
 * `.inspectpanel__section` — but a rule that could never apply:
 * react-resizable-panels writes `overflow: hidden` as an INLINE style on every
 * `Panel`, and an inline style outranks any class rule.
 *
 * So the scroll has to live INSIDE the pane, and these tests pin the two facts
 * that make that necessary and sufficient:
 *
 *  1. The library really does write that inline style (rendered, not assumed —
 *     if a future version stops, this test says so and the workaround can go).
 *  2. Each pane's scrolling child is allowed to SHRINK: `min-height: 0` next to
 *     its `overflow`. Without it a flex child is floored at its content height,
 *     the overflow never engages, and the list is clipped exactly as before.
 *     This repo has been bitten by that rule more than once, and it is invisible
 *     in a component test — only the stylesheet says it.
 */

const css = (file: string): string =>
  readFileSync(resolve(__dirname, '../src/renderer/src', file), 'utf8').replace(
    /\/\*[\s\S]*?\*\//g,
    ''
  )

const OUTLINE_CSS = css('components/OutlinePanel.css')
const VARS_CSS = css('components/VariablesPanel.css')
const INDEX_CSS = css('index.css')

/** The declarations of the LAST rule whose selector is exactly `selector`. */
function ruleBody(sheet: string, selector: string): string {
  const bodies = [...sheet.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter(([, sel]) => sel.trim() === selector)
    .map(([, , body]) => body)
  expect(bodies.length, `a rule for ${selector}`).toBeGreaterThan(0)
  return bodies.join(';')
}

/** `decl(body, 'min-height')` → `'0'`, or `undefined` when not declared. */
function decl(body: string, property: string): string | undefined {
  const m = new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;]+)`, 'i').exec(body)
  return m?.[1].trim()
}

describe('why the panes cannot scroll themselves', () => {
  it('react-resizable-panels forces overflow:hidden inline on every Panel', () => {
    // The Inspect view's two panes, in the shape `InspectPanel` builds them (the
    // component itself needs the workspace/device context to render, and the
    // fact under test belongs to the library, not to the component).
    const markup = renderToStaticMarkup(
      <PanelGroup direction="vertical">
        <Panel order={1} minSize={20} defaultSize={60} className="inspectpanel__section">
          <div className="outline" />
        </Panel>
        <PanelResizeHandle />
        <Panel order={2} minSize={20} defaultSize={40} className="inspectpanel__section">
          <div className="vars" />
        </Panel>
      </PanelGroup>
    )
    const panes = [...markup.matchAll(/class="inspectpanel__section"[^>]*style="([^"]*)"/g)].map(
      (m) => m[1]
    )
    expect(panes.length, 'both split panes rendered').toBe(2)
    for (const style of panes) expect(style).toMatch(/overflow\s*:\s*hidden/)
  })

  it('so the pane rule never claims to scroll — that rule would be dead code', () => {
    const pane = ruleBody(INDEX_CSS, '.inspectpanel__section')
    expect(decl(pane, 'overflow')).toBe('hidden')
  })
})

describe('each pane scrolls its own list instead', () => {
  const scrollers: Array<[string, string, string]> = [
    ['.outline__list', OUTLINE_CSS, '.outline'],
    ['.vars__list', VARS_CSS, '.vars'],
    // The empty states ("Open a file…", "Connect a board…") share the pane and
    // must not be clipped in a short pane either.
    ['.outline__hint', OUTLINE_CSS, '.outline'],
    ['.vars__hint', VARS_CSS, '.vars']
  ]

  it.each(scrollers)('%s scrolls AND is allowed to shrink (min-height: 0)', (sel, sheet) => {
    const body = ruleBody(sheet, sel)
    expect(decl(body, 'overflow-y') ?? decl(body, 'overflow')).toMatch(/auto|scroll/)
    // The trap: without this the flex child cannot shrink below its content, so
    // the overflow never engages and the list is clipped rather than scrolled.
    expect(decl(body, 'min-height'), `${sel} must be allowed to shrink`).toBe('0')
    expect(decl(body, 'flex'), `${sel} takes the leftover space`).toMatch(/^1 1/)
  })

  it.each([
    ['.outline', OUTLINE_CSS],
    ['.vars', VARS_CSS]
  ])('%s fills its pane as a shrinkable flex column', (sel, sheet) => {
    const body = ruleBody(sheet, sel)
    expect(decl(body, 'display')).toBe('flex')
    expect(decl(body, 'flex-direction')).toBe('column')
    expect(decl(body, 'height')).toBe('100%')
    expect(decl(body, 'min-height')).toBe('0')
  })

  it('the variables toolbar stays put rather than scrolling away with the rows', () => {
    // Count + Refresh are the pane's controls; if they scrolled, refreshing a
    // long list would mean scrolling back to the top to find the button.
    expect(decl(ruleBody(VARS_CSS, '.vars__toolbar'), 'flex')).toBe('0 0 auto')
    expect(decl(ruleBody(VARS_CSS, '.vars__error'), 'flex')).toBe('0 0 auto')
  })

  it('the scroll rules add no colour of their own (both skins keep their tokens)', () => {
    // Scrollbars follow `color-scheme`, which each skin sets — so making a list
    // scroll must not introduce a colour that only reads on one of them.
    for (const [sel, sheet] of scrollers) {
      const body = ruleBody(sheet, sel)
      expect(body, `${sel} must not carry a literal colour`).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
      // Any colour these rules DO carry has to come from a theme token.
      for (const [, value] of body.matchAll(/\b(?:background|color)\s*:\s*([^;]+)/g)) {
        expect(value, `${sel} colour must be a token`).toMatch(/var\(--/)
      }
    }
  })
})
