import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * A region's chrome must not bleed into a modal rendered inside it (#969).
 *
 * The shell header is a dark green bar, so its controls are painted near-white:
 *
 *     .region--shell .conn-control .btn--ghost       color: #eafff2
 *     .region--shell .conn-control .btn--ghost:hover color: #fff
 *
 * But `ConnectionControl` renders the Simulated-device memory dialog INLINE —
 * `{memOpen && <SimMemoryDialog …/>}` is a sibling of the header controls, not a
 * portal — so the dialog is a DOM descendant of `.conn-control`. Its Cancel
 * button is a plain `.btn--ghost` too, so a *descendant* combinator reached it
 * and painted white text on the dialog's parchment card. Invisible; worse on
 * hover, which is where the user first noticed it.
 *
 * Every real header control is a direct child of `.conn-control`, so the child
 * combinator keeps the header identical and stops the bleed.
 */

function stylesheets(dir = 'src/renderer/src'): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) out.push(...stylesheets(p))
    else if (name.endsWith('.css')) out.push(p)
  }
  return out
}

/** `.btn`, `.btn--ghost`, … — the classes ANY button in the app wears, modals included. */
const GENERIC_BTN = /(^|[\s>+~])\.btn(--[a-z-]+)?(?=$|[\s>+~:.[])/

type Rule = { file: string; line: number; selector: string }

/** Repaints the button — the bleed that makes a modal's control unreadable. */
const PAINTS = /(?<!-)\b(color|background(-color|-image)?)\s*:/

/** Every selector that reaches a generic `.btn` from an ancestor, split by combinator. */
function rulesReachingAButton(): { descendant: Rule[]; child: Rule[] } {
  const descendant: Rule[] = []
  const child: Rule[] = []
  for (const file of stylesheets()) {
    const text = readFileSync(file, 'utf8')
    // Strip comments so a selector quoted in prose isn't mistaken for a rule.
    const clean = text.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' '))
    for (const m of clean.matchAll(/([^{}]+)\{[^{}]*\}/g)) {
      const line = clean.slice(0, m.index).split('\n').length
      if (!PAINTS.test(m[0].slice(m[0].indexOf('{')))) continue
      for (const raw of m[1].split(',')) {
        const selector = raw.trim().replace(/\s+/g, ' ')
        if (!selector || !GENERIC_BTN.test(selector)) continue
        // Only compound selectors — a bare `.btn--ghost { … }` is the button's own rule.
        const btnAt = selector.search(GENERIC_BTN)
        const prefix = selector.slice(0, btnAt).trim()
        if (!prefix) continue
        // The skins legitimately theme every button: `:root[data-theme='x'] .btn`.
        if (/^:root\[data-theme=/.test(prefix)) continue
        const combinator = selector.slice(btnAt, btnAt + 1)
        ;(combinator === '>' || / > $/.test(selector.slice(0, btnAt + 1))
          ? child
          : descendant
        ).push({ file, line, selector })
      }
    }
  }
  return { descendant, child }
}

describe('the shell header does not paint the dialog inside it (#969)', () => {
  const shellCss = 'src/renderer/src/components/ShellPanel.css'

  it('scopes every .conn-control button rule to direct children', () => {
    const { descendant } = rulesReachingAButton()
    const leaks = descendant.filter((r) => r.selector.includes('.conn-control'))
    expect(
      leaks.map((r) => `${r.file}:${r.line}  ${r.selector}`),
      'a descendant combinator here reaches into SimMemoryDialog — use `>`'
    ).toEqual([])
  })

  it('still styles the header chips it is there to style', () => {
    // The fix must not have deleted the green-bar treatment along the way.
    const css = readFileSync(shellCss, 'utf8')
    for (const sel of [
      '.region--shell .conn-control > .btn--ghost',
      '.region--shell .conn-control > .btn--danger',
      '.region--shell .conn-control > .btn--primary'
    ]) {
      expect(css, `${sel} should still exist`).toContain(sel)
    }
  })

  it('is guarding a dialog that really is nested inside .conn-control', () => {
    // If SimMemoryDialog is ever moved to a portal the bleed goes away on its
    // own — but until then this is why the child combinator above matters.
    const tsx = readFileSync('src/renderer/src/components/ConnectionControl.tsx', 'utf8')
    const open = tsx.indexOf('<div className="conn-control"')
    expect(open, 'ConnectionControl should still render a .conn-control container').toBeGreaterThan(-1)
    expect(tsx.indexOf('<SimMemoryDialog'), 'dialog is rendered inline, inside that container').toBeGreaterThan(open)
  })
})

describe('no new region chrome can reach a modal button unnoticed', () => {
  /**
   * A tripwire, not a ban. Each of these reaches a generic `.btn` through a
   * descendant combinator, which is fine ONLY while no fixed-position overlay is
   * rendered inside that container. Both entries below were checked (#969):
   *
   *   .editor-header__actions  — two plain buttons, Chat and Find. No overlay.
   *   .btn-seg                 — the fused icon toolbars in the file trees. No overlay.
   *
   * Rules that only set geometry (the file trees' compact `.btn` padding) are not
   * listed: they cannot make a control unreadable, which is the failure guarded here.
   *
   * Adding a row means confirming the same thing for the new container: does any
   * component render a dialog, popup or context menu inside it? If so, use `>`.
   */
  const REVIEWED = ['.editor-header__actions .btn', '.btn-seg .btn']

  it('has only reviewed descendant rules over a generic .btn', () => {
    const { descendant } = rulesReachingAButton()
    const unreviewed = descendant.filter(
      (r) => !REVIEWED.some((known) => r.selector.startsWith(known))
    )
    expect(
      unreviewed.map((r) => `${r.file}:${r.line}  ${r.selector}`),
      'new descendant rule over a generic .btn — check nothing modal renders inside, then add it to REVIEWED'
    ).toEqual([])
  })
})
