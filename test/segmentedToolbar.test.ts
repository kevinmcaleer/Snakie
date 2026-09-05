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
const LOCAL_TSX = readFileSync('src/renderer/src/components/LocalFileTree.tsx', 'utf8')
const DEVICE_TSX = readFileSync('src/renderer/src/components/DeviceFileTree.tsx', 'utf8')
const ICONS = readFileSync('src/renderer/src/components/file-tree-icons.tsx', 'utf8')

/** The bounding box of every `d="…"` and `<rect>` in an icon's source, in the
 *  16-unit viewBox — how BIG a glyph reads, which is not the same as the px it
 *  is rendered at. */
function glyphBox(src: string, name: string): { w: number; h: number } {
  const start = src.indexOf(`const ${name} = `)
  if (start === -1) throw new Error(`no icon named ${name}`)
  const body = src.slice(start, src.indexOf('\n)', start))
  const xs: number[] = []
  const ys: number[] = []
  // Path data: every number, alternating x/y from the first move.
  for (const m of body.matchAll(/d="([^"]+)"/g)) {
    const nums = (m[1].match(/-?\d*\.?\d+/g) ?? []).map(Number)
    // Absolute-ish approximation: the glyphs here are drawn with absolute
    // commands and short relative runs, so min/max over all coordinates is a
    // fair read of the box they occupy.
    nums.forEach((n, i) => (i % 2 === 0 ? xs : ys).push(n))
  }
  for (const m of body.matchAll(/<rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)"/g)) {
    const [x, y, w, h] = m.slice(1).map(Number)
    xs.push(x, x + w)
    ys.push(y, y + h)
  }
  if (xs.length === 0) throw new Error(`no geometry in ${name}`)
  return { w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) }
}

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


describe('the full-width variant (#868)', () => {
  it('spans the panel and centres its buttons', () => {
    const rule = block(INDEX, '\n.btn-seg--full {')
    expect(rule).toContain('width: 100%')
    expect(rule).toContain('justify-content: center')
    // `display: flex` has to beat `.btn-seg`'s `inline-flex` at equal
    // specificity, which only works if this rule comes after it.
    expect(rule).toContain('display: flex')
    expect(INDEX.indexOf('.btn-seg--full {')).toBeGreaterThan(INDEX.indexOf('\n.btn-seg {'))
  })

  it('is used by BOTH panels, so neither toolbar hugs one end', () => {
    expect(LOCAL_TSX).toContain('btn-seg btn-seg--full')
    expect(DEVICE_TSX).toContain('btn-seg btn-seg--full')
  })

  it('gives the device header a row of its own for the toolbar', () => {
    // It used to share the title's row, where the base rule's `space-between`
    // pushed it to one end — the asymmetry reported in #868.
    const rule = block(readFileSync('src/renderer/src/components/DeviceFileTree.css', 'utf8'), '.devicetree__header {')
    expect(rule).toContain('flex-direction: column')
    expect(rule).not.toContain('space-between')
  })

  it('leaves nothing competing to re-pad the device icon buttons', () => {
    // A live `.devicetree__header .btn` padding rule and `.btn.btn--icon` tie on
    // specificity, so which one wins is decided by CSS file order — not a thing
    // to leave load-bearing when the complaint is "one panel's icons look
    // bigger". Commented out, not just outranked.
    expect(INDEX).not.toMatch(/^\.devicetree__header \.btn \{/m)
  })
})

describe('one set of icons, one size (#868)', () => {
  it('is defined once and imported by both panels', () => {
    for (const name of ['RefreshIcon', 'NewFileIcon', 'NewFolderIcon']) {
      expect(ICONS, name).toContain(`export const ${name}`)
      // Neither panel keeps its own copy — that is how they drifted.
      expect(LOCAL_TSX, `${name} in LocalFileTree`).not.toContain(`const ${name} = (`)
      expect(DEVICE_TSX, `${name} in DeviceFileTree`).not.toContain(`const ${name} = (`)
    }
    for (const tsx of [LOCAL_TSX, DEVICE_TSX]) {
      expect(tsx).toContain("from './file-tree-icons'")
    }
  })

  it('sizes them from one shared `iconProps`', () => {
    expect(ICONS).toContain('export const iconProps')
    expect(LOCAL_TSX).not.toContain('const iconProps = {')
    expect(DEVICE_TSX).not.toContain('const iconProps = {')
  })

  it('draws the device-only glyphs to the same optical size as the shared ones', () => {
    // The reported "ever so slightly larger" was real but not a sizing bug: the
    // sync arrows were drawn 14 units wide inside the same 14px box where
    // Refresh is drawn 10, so they carried more ink and read bigger.
    const ref = glyphBox(ICONS, 'RefreshIcon')
    for (const name of ['SyncIcon', 'CheckIcon']) {
      const box = glyphBox(DEVICE_TSX, name)
      expect(box.w, `${name} width`).toBeLessThanOrEqual(ref.w)
      expect(box.h, `${name} height`).toBeLessThanOrEqual(ref.h)
    }
  })
})
