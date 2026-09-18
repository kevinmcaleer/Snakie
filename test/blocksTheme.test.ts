import { describe, it, expect } from 'vitest'
import {
  BLOCK_CATEGORIES,
  FALLBACK_TOKENS,
  buildSoftShellTheme,
  categoryColour,
  categoryStyleName,
  greyOf,
  mixHex,
  readThemeTokens,
  relativeLuminance,
  softShellWorkspaceOptions
} from '../src/renderer/src/lib/blocks/theme'

/**
 * The Soft Shell Blockly theme (#1009). Blockly paints SVG fills, so the theme
 * needs real colour values — but Soft Shell's rule (epic #859) is that colour
 * lives in the tokens and both skins come from the same source. These pin the
 * mapping, which is the half with opinions in it.
 */
describe('buildSoftShellTheme (#1009)', () => {
  const theme = buildSoftShellTheme(FALLBACK_TOKENS)

  it('gives every category a style, and every style a category', () => {
    const styleNames = Object.keys(theme.categoryStyles).sort()
    expect(styleNames).toEqual(BLOCK_CATEGORIES.map((c) => categoryStyleName(c.id)).sort())
  })

  it('paints a category from the token it declares — no hard-coded hex', () => {
    // Still the rule: every colour is derived from a token, whether or not the
    // category moves it to its own hue. A literal hex in the table is the thing
    // this is here to stop.
    for (const c of BLOCK_CATEGORIES) {
      expect(theme.categoryStyles[categoryStyleName(c.id)].colour).toBe(
        categoryColour(FALLBACK_TOKENS, c)
      )
    }
  })

  it('paints every category from the block palette, not from a syntax token', () => {
    // THE CONTRACT INVERSION #1099 DIAGNOSED. `--kw`, `--num`, `--ident` are
    // FOREGROUND colours, picked to be readable *on* the editor background; used
    // as block FILLS they inverted with the skin — pale blocks in the dark theme,
    // dark ones on parchment — and their lightness ran from 20% to 81% within a
    // single skin. The blocks have a palette of their own now.
    const syntax = [
      FALLBACK_TOKENS.kw,
      FALLBACK_TOKENS.str,
      FALLBACK_TOKENS.num,
      FALLBACK_TOKENS.com,
      FALLBACK_TOKENS.ident,
      FALLBACK_TOKENS.green,
      FALLBACK_TOKENS.gold,
      FALLBACK_TOKENS.pinGpio,
      FALLBACK_TOKENS.pinPower
    ]
    for (const c of BLOCK_CATEGORIES) {
      expect({ id: c.id, borrowed: syntax.includes(categoryColour(FALLBACK_TOKENS, c)) }).toEqual({
        id: c.id,
        borrowed: false
      })
    }
  })

  it('gives every category a colour of its own', () => {
    // The defect the old table was fixed for: fifteen drawers over nine tokens,
    // and two of the clashes were between DIFFERENT tokens — `kw` sat one
    // degree off `pinPower`, `str` three degrees off `pinGpio`. A learner could
    // not tell a Text block from a Hardware one.
    const colours = BLOCK_CATEGORIES.map((c) => categoryColour(FALLBACK_TOKENS, c))
    expect(new Set(colours).size).toBe(BLOCK_CATEGORIES.length)
  })

  it('keeps every block at the same DEPTH, measured as luminance', () => {
    // What makes it read as one palette, and what equal HSL lightness could not
    // do: a yellow and a blue at the same L are nowhere near the same
    // brightness, which is why Scratch's own yellow carries white text at
    // 1.9:1. Equal luminance is also what makes one ink colour work on all of
    // them.
    //
    // `hardware` is off the depth on purpose — it keeps the bright GPIO amber
    // and carries black lettering instead of white. `blocksContrast.test.ts`
    // owns that exception, both halves of it: that it really is off the depth,
    // and that it still clears AA with the ink its own fill asks for.
    const vivid = BLOCK_CATEGORIES.filter((c) => c.id !== 'hardware')
      .map((c) => categoryColour(FALLBACK_TOKENS, c))
      .filter((colour) => hsl(colour).s > 30)
    const lums = vivid.map(relativeLuminance)
    expect(Math.max(...lums) - Math.min(...lums)).toBeLessThan(0.01)
  })

  it('keeps the vivid categories at least 20° apart on the wheel', () => {
    // Near-greys are excluded on purpose: they take no hue space and are told
    // apart by lightness, which is why variables and python can share a corner.
    const vivid = BLOCK_CATEGORIES.map((c) => ({
      id: c.id,
      ...hsl(categoryColour(FALLBACK_TOKENS, c))
    })).filter((c) => c.s > 30)

    const tooClose: string[] = []
    for (const a of vivid) {
      for (const b of vivid) {
        if (a.id >= b.id) continue
        const d = Math.abs(a.h - b.h)
        if (Math.min(d, 360 - d) < 20) tooClose.push(`${a.id}/${b.id}`)
      }
    }
    expect(tooClose).toEqual([])
  })

  it('derives each block\'s three shades rather than hand-picking them', () => {
    const turtle = theme.blockStyles['turtle_blocks']
    expect(turtle.colourPrimary).toBe(FALLBACK_TOKENS.blockTurtle)
    expect(turtle.colourSecondary).not.toBe(turtle.colourPrimary)
    expect(turtle.colourTertiary).not.toBe(turtle.colourPrimary)
    for (const v of Object.values(turtle)) expect(v).toMatch(/^#[0-9a-f]{6}$/i)
  })

  it('takes its surfaces from the app, so the canvas is the same paper', () => {
    expect(theme.componentStyles.workspaceBackgroundColour).toBe(FALLBACK_TOKENS.editor)
    expect(theme.componentStyles.toolboxBackgroundColour).toBe(FALLBACK_TOKENS.panel)
    expect(theme.componentStyles.insertionMarkerColour).toBe(FALLBACK_TOKENS.gold)
  })

  it('puts the Soft Shell UI face on block text', () => {
    expect(theme.fontStyle.family).toContain('Plus Jakarta Sans')
  })

  it('hats every top-level block — "programs start here"', () => {
    expect(theme.startHats).toBe(true)
  })

  it('rebuilds differently for a different skin', () => {
    const parchment = buildSoftShellTheme({ ...FALLBACK_TOKENS, editor: '#f4eede', panel: '#f6f1e6' })
    expect(parchment.componentStyles.workspaceBackgroundColour).toBe('#f4eede')
    expect(theme.componentStyles.workspaceBackgroundColour).toBe('#191c15')
  })
})

describe('readThemeTokens (#1009)', () => {
  it('falls back rather than building a theme out of empty strings', () => {
    // A detached node, a test, or the first frame before the stylesheet lands
    // all read back ''. Invisible blocks would be the alternative.
    expect(readThemeTokens(null)).toEqual(FALLBACK_TOKENS)
  })
})

describe('mixHex (#1009)', () => {
  it('blends, and clamps at both ends', () => {
    expect(mixHex('#000000', '#ffffff', 0.5)).toBe('#808080')
    expect(mixHex('#102030', '#ffffff', 0)).toBe('#102030')
    expect(mixHex('#102030', '#405060', 1)).toBe('#405060')
    expect(mixHex('#000000', '#ffffff', 5)).toBe('#ffffff')
  })

  it('returns the first colour unchanged for anything it cannot parse', () => {
    // A silent misparse would produce a plausible-looking WRONG colour. Three
    // digits ARE parsed — `index.css` writes `--card: #fff` — so the shorthand
    // is the same notation rather than an unknown one (#1099).
    expect(mixHex('#fff', '#000000', 0)).toBe('#ffffff')
    expect(mixHex('rgb(1,2,3)', '#ffffff', 0.5)).toBe('rgb(1,2,3)')
  })
})

describe('softShellWorkspaceOptions (#1009)', () => {
  it('turns the grid on in the app\'s own rule colour, and the sounds off', () => {
    const o = softShellWorkspaceOptions(FALLBACK_TOKENS)
    expect(o.grid?.colour).toBe(FALLBACK_TOKENS.line)
    expect(o.grid?.snap).toBe(true)
    expect(o.sounds).toBe(false)
    expect(o.trashcan).toBe(true)
    expect(o.zoom?.controls).toBe(true)
  })
})

describe('comments recede (#1062)', () => {
  it('greyOf keeps the brightness and drops the colour', () => {
    // Rec. 601 luma, not a channel average: a naive mean turns a mid green
    // darker than the mid red beside it, and the grey has to sit at the same
    // visual depth as the token it came from.
    expect(greyOf('#a39877')).toBe('#989898')
    expect(greyOf('#6f7a63')).toBe('#747474')
    expect(greyOf('#ffffff')).toBe('#ffffff')
    expect(greyOf('#000000')).toBe('#000000')
  })

  it('leaves anything that is not a hex colour alone', () => {
    expect(greyOf('rebeccapurple')).toBe('rebeccapurple')
    // …but the three-digit shorthand is a hex colour, and `index.css` uses it.
    expect(greyOf('#fff')).toBe('#ffffff')
  })

  it('gives the comment block a style of its own, not the Python one', () => {
    // The Python category already wears the COMMENT token, so painting comments
    // "the comment colour" would have made them identical to the raw-Python
    // blocks they sit among.
    const theme = buildSoftShellTheme(FALLBACK_TOKENS)
    expect(theme.blockStyles.comment_blocks).toBeDefined()
    expect(theme.blockStyles.comment_blocks.colourPrimary).not.toBe(
      theme.blockStyles.python_blocks.colourPrimary
    )
    // …and it is a true neutral: all three channels equal.
    const [, r, g, b] = /^#(..)(..)(..)$/.exec(theme.blockStyles.comment_blocks.colourPrimary)!
    expect(r).toBe(g)
    expect(g).toBe(b)
  })
})

/** HSL of a 6-digit hex, for the palette assertions above. */
function hsl(hex: string): { h: number; s: number; l: number } {
  const n = parseInt(hex.slice(1), 16)
  const r = ((n >> 16) & 255) / 255
  const g = ((n >> 8) & 255) / 255
  const b = (n & 255) / 255
  const mx = Math.max(r, g, b)
  const mn = Math.min(r, g, b)
  const d = mx - mn
  let h = 0
  if (d !== 0) {
    if (mx === r) h = ((g - b) / d) % 6
    else if (mx === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
    h *= 60
    if (h < 0) h += 360
  }
  const l = (mx + mn) / 2
  return { h: Math.round(h), s: Math.round((d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1))) * 100), l: Math.round(l * 100) }
}

