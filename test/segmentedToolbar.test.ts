import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

/**
 * The segmented icon group — the file panels' "mini toolbar" (#865).
 *
 * These are assertions about the CASCADE, which is where this feature is either
 * right or broken and where nothing else would catch it: the group looks
 * correct in one skin and falls apart in the other, and no unit test of any
 * component would notice. The specific trap is that the skeuomorph skin styles
 * `.btn` with three selector components, so an unscoped `.btn-seg .btn` (two)
 * loses to it and the children keep their pill borders inside the group.
 */

const INDEX = readFileSync('src/renderer/src/index.css', 'utf8')

/** The declaration block for a selector, or '' when the rule is absent. */
function block(css: string, selector: string): string {
  const i = css.indexOf(selector)
  if (i === -1) return ''
  const open = css.indexOf('{', i)
  const close = css.indexOf('}', open)
  return open === -1 || close === -1 ? '' : css.slice(open + 1, close)
}

describe('the group itself', () => {
  it('exists, and fuses its children with no gap between them', () => {
    const rule = block(INDEX, '\n.btn-seg {')
    expect(rule).toContain('display: inline-flex')
    // A gap would open the group's own background through the middle of what is
    // meant to read as one control.
    expect(rule).toMatch(/gap:\s*0;/)
    expect(rule).toContain('overflow: hidden')
  })

  it('takes every colour from a theme token', () => {
    // A literal here would look right in one skin and wrong in the other — the
    // failure mode the whole two-skin rule exists to prevent.
    const rule = block(INDEX, '\n.btn-seg {')
    expect(rule).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
    expect(rule).toContain('var(--')
  })
})

describe('the skin-scoped twin of every child rule', () => {
  // `:root[data-theme='skeuomorph'] .btn` outranks `.btn-seg .btn`, so each
  // child rule has to be written twice. Losing one of the twins is a silent
  // break in exactly one skin, which is why this is asserted rather than
  // trusted.
  const childRules = [
    '.btn-seg .btn,',
    '.btn-seg .btn + .btn,',
    '.btn-seg .btn:hover:not(:disabled),',
    '.btn-seg .btn:active:not(:disabled),',
    '.btn-seg .btn.is-active,'
  ]

  for (const rule of childRules) {
    const scoped = `:root[data-theme='skeuomorph'] ${rule.replace(/,$/, '')} {`
    it(`pairs \`${rule.replace(/,$/, '')}\` with its skeuomorph twin`, () => {
      expect(INDEX).toContain(rule)
      expect(INDEX).toContain(scoped)
    })
  }

  it('strips the pill off the children so they read as one control', () => {
    const rule = block(INDEX, '\n.btn-seg .btn,')
    expect(rule).toContain('border: none')
    expect(rule).toContain('border-radius: 0')
    expect(rule).toContain('background: transparent')
  })

  it('draws a seam between adjacent segments', () => {
    expect(block(INDEX, '\n.btn-seg .btn + .btn,')).toContain('border-left:')
  })
})

describe('the active toggle inside the group', () => {
  it('fills its segment but does NOT set a colour', () => {
    // The device tree colours its sync button green on success / red on failure
    // with a doubled class (0,2,0). A `color` here would be (0,3,0) and win, so
    // a completed sync would stop reading as green whenever auto-sync was on.
    const rule = block(INDEX, '\n.btn-seg .btn.is-active,')
    expect(rule).toContain('background:')
    expect(rule).not.toMatch(/(^|[;\s])color:/)
  })
})

describe('both file panels use it', () => {
  const panels = [
    {
      name: 'Local files',
      tsx: 'src/renderer/src/components/LocalFileTree.tsx',
      css: 'src/renderer/src/components/LocalFileTree.css',
      actions: '.localtree__header-actions {'
    },
    {
      name: 'Device files',
      tsx: 'src/renderer/src/components/DeviceFileTree.tsx',
      css: 'src/renderer/src/components/DeviceFileTree.css',
      actions: '.devicetree__header-actions {'
    }
  ]

  for (const p of panels) {
    it(`${p.name}: the header actions are a segmented group`, () => {
      expect(readFileSync(p.tsx, 'utf8')).toContain('btn-seg')
    })

    it(`${p.name}: the group is a labelled toolbar for screen readers`, () => {
      expect(readFileSync(p.tsx, 'utf8')).toMatch(/role="toolbar"/)
    })

    it(`${p.name}: its own rule sets no gap, which would break the seam`, () => {
      // Component CSS loads after index.css, so a `gap` here beats the group's
      // `gap: 0` at equal specificity and prises the buttons apart.
      expect(block(readFileSync(p.css, 'utf8'), p.actions)).not.toMatch(/(^|[;\s])gap:/)
    })
  }
})
