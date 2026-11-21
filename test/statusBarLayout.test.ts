import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

/**
 * The status bar's shrink order (#843).
 *
 * Asserted against the stylesheet because the bug is a LAYOUT one that only
 * appears at a narrow window: the right-hand group inherited `flex-shrink: 1`,
 * its fixed-width children overflowed it, and the bar's `overflow: hidden`
 * quietly cut the Flash button off the right edge. Nothing throws, nothing
 * logs — the control is simply not there any more.
 */
const css = readFileSync('src/renderer/src/components/StatusBar.css', 'utf8')

/** The body of one rule, so a declaration can be attributed to its selector. */
function rule(selector: string): string {
  const i = css.indexOf(`${selector} {`)
  expect(i, `${selector} should exist`).toBeGreaterThan(-1)
  return css.slice(i, css.indexOf('}', i))
}

describe('status bar shrink order (#843)', () => {
  it('never shrinks the right-hand group', () => {
    // Line count, saved state, changed files, version, coffee and Flash all
    // live here, and every one of them must stay visible.
    expect(rule('.statusbar__group--right')).toMatch(/flex:\s*0\s+0\s+auto/)
  })

  it('lets the message area on the left give way instead', () => {
    const left = rule('.statusbar__group--left')
    expect(left).toMatch(/flex:\s*1\s+1\s+auto/)
    expect(left).toMatch(/min-width:\s*0/)
    // ...and clip, so its fixed-width items cannot draw over the right group.
    expect(left).toMatch(/overflow:\s*hidden/)
  })

  it('keeps the flash button whole', () => {
    expect(rule('.statusbar__flash-wrap')).toMatch(/flex:\s*0\s+0\s+auto/)
  })

  it('puts the flash button last, hard against the right edge', () => {
    const tsx = readFileSync('src/renderer/src/components/StatusBar.tsx', 'utf8')
    const right = tsx.indexOf('statusbar__group--right')
    expect(tsx.indexOf('statusbar__flash-wrap')).toBeGreaterThan(right)
    // Nothing may follow it inside the group.
    const after = tsx.slice(tsx.indexOf('statusbar__flash-wrap'))
    expect(after.indexOf('</footer>')).toBeGreaterThan(-1)
  })
})

describe('status bar in the Build workspace', () => {
  const tsx = readFileSync('src/renderer/src/components/StatusBar.tsx', 'utf8')
  const shell = readFileSync('src/renderer/src/components/AppShell.tsx', 'utf8')

  it('is told when Build is showing', () => {
    expect(shell).toMatch(/<StatusBar[^>]*build=\{robotMain\}/s)
  })

  it('drops the code and board items there, and keeps the rest', () => {
    // Each of these sits behind the `build` flag…
    for (const cls of ['statusbar__conn', 'statusbar__save', 'statusbar__flash-wrap']) {
      const at = tsx.indexOf(`className={\`statusbar__item ${cls}`)
      const i = at > -1 ? at : tsx.indexOf(`className="${cls}"`)
      expect(i, cls).toBeGreaterThan(-1)
      expect(tsx.slice(i - 160, i), cls).toMatch(/\{!build && \(/)
    }
    // The runtime switcher shows even with no board (it picks the help's Python),
    // but still steps aside in Build.
    expect(tsx).toMatch(/\{!build && \(\s*<button\s+type="button"\s+className=\{`statusbar__item statusbar__runtime/)
    expect(tsx).toMatch(/\{lines != null && !build && \(/)
    expect(tsx).toMatch(/tipSlotFree &&\s+!build &&/)
    // …while sync and the coffee link are unconditional.
    expect(tsx).toMatch(/\n\s*<SyncIndicator \/>/)
    expect(tsx).toMatch(/\n\s*<CoffeeLink \/>/)
  })
})
