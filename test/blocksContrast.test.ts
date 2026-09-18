import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'
import {
  BLOCK_CATEGORIES,
  FALLBACK_TOKENS,
  buildSoftShellTheme,
  categoryColour,
  contrastRatio,
  readableTextOn,
  relativeLuminance,
  type ThemeTokens
} from '../src/renderer/src/lib/blocks/theme'

/**
 * BLOCK TEXT CONTRAST (#1099, with #1098).
 * =============================================================================
 *
 * The bug, measured: **block text is white on every block, always**, because
 * Blockly injects `.blocklyText { fill: #fff }` and a `BlockStyle` carries three
 * fill colours and no text colour at all. Against the old category colours that
 * left **eleven of fifteen categories below 3.0:1 in the dark skin** — which is
 * the floor even for large bold text — and Variables at 1.51:1, a near-white
 * block with near-white text on it.
 *
 * THE ROOT CAUSE WAS A CONTRACT INVERSION. The Soft Shell tokens are syntax
 * highlight colours — FOREGROUNDS, picked to be readable *on* the editor
 * background — and the block theme used them as block FILLS. So the blocks
 * inverted with the skin, and their lightness scattered from 20% to 81% inside
 * one skin. The blocks have a palette of their own now: one set of fills for
 * BOTH skins, with only the canvas behind them changing.
 *
 * THE TOKENS ARE READ OUT OF `index.css`, not copied here. A test with its own
 * copy of the palette passes forever while the app goes wrong; this one fails
 * when somebody edits a token, which is the whole point of asking for it.
 */

const INDEX_CSS = resolve(__dirname, '../src/renderer/src/index.css')

/** Every `--custom-property: value` declaration under selectors matching `want`. */
function tokensFor(want: (selector: string) => boolean): Map<string, string> {
  // Comments out first: a `/* … */` before a rule is part of the text between
  // the previous `}` and the next `{`, so it would land in the selector and
  // make an exact match on `:root` impossible.
  const css = readFileSync(INDEX_CSS, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
  const out = new Map<string, string>()
  // Selector + body pairs, shallow — `index.css` has no nesting at :root level.
  for (const [, selector, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!want(selector.trim())) continue
    for (const [, name, value] of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
      out.set(name, value.trim())
    }
  }
  return out
}

/** The skin's tokens as the theme sees them, with `FALLBACK_TOKENS`'s keys. */
function skin(want: (selector: string) => boolean): ThemeTokens {
  const declared = tokensFor(want)
  // The same mapping `TOKEN_VARS` makes, derived from the fallbacks so a token
  // added to `ThemeTokens` without a CSS home fails here rather than silently
  // reading its fallback.
  const vars: Record<string, string> = {
    editor: '--editor',
    panel: '--panel',
    card: '--card',
    line: '--line',
    gutter: '--gutter',
    head: '--head',
    txt2: '--txt2',
    green: '--green',
    gold: '--gold',
    kw: '--kw',
    str: '--str',
    num: '--num',
    com: '--com',
    ident: '--ident',
    pinGpio: '--pin-gpio',
    pinPower: '--pin-power',
    blockTurtle: '--block-turtle',
    blockHardware: '--block-hardware',
    blockInstruments: '--block-instruments',
    blockParts: '--block-parts',
    blockModules: '--block-modules',
    blockWait: '--block-wait',
    blockControl: '--block-control',
    blockLogic: '--block-logic',
    blockMath: '--block-math',
    blockText: '--block-text',
    blockLists: '--block-lists',
    blockVariables: '--block-variables',
    blockFunctions: '--block-functions',
    blockPlugins: '--block-plugins',
    blockPython: '--block-python'
  }
  const out = {} as ThemeTokens
  for (const [key, cssVar] of Object.entries(vars)) {
    const value = declared.get(cssVar)
    expect(value, `${cssVar} is not declared in index.css`).toBeDefined()
    out[key as keyof ThemeTokens] = value as string
  }
  return out
}

/** The dark skin: `:root` and `:root[data-theme='dark']`, in file order. */
const DARK = skin((s) => /:root(\s*,|\s*\[data-theme='dark'\])?$/.test(s) || s === ':root')
/** Parchment: everything the dark skin has, with the skeuomorph block on top. */
const SKEUOMORPH = skin(
  (s) => s === ':root' || /:root\s*,/.test(s) || s.includes("data-theme='skeuomorph'")
)

const SKINS: [string, ThemeTokens][] = [
  ['dark', DARK],
  ['skeuomorph', SKEUOMORPH]
]

/** WCAG AA for normal text. Block text is 12px/600, so 3.0:1 does not apply. */
const AA = 4.5

describe('the block palette is one palette, in both skins', () => {
  it('paints a block the same colour whichever skin is on', () => {
    // The thing that made the old scheme look wrong, stated as a test: the
    // fills used to be syntax FOREGROUNDS, so they inverted with the skin —
    // pale blocks in the dark theme, dark ones on parchment. Only the canvas
    // behind them changes now, which is what Scratch and MakeCode do.
    for (const category of BLOCK_CATEGORIES) {
      expect({
        id: category.id,
        colour: categoryColour(SKEUOMORPH, category)
      }).toEqual({ id: category.id, colour: categoryColour(DARK, category) })
    }
  })

  it('but the canvas under them does change', () => {
    expect(SKEUOMORPH.editor).not.toBe(DARK.editor)
    expect(SKEUOMORPH.panel).not.toBe(DARK.panel)
  })

  it('keeps every block at one depth, so one ink serves all of them', () => {
    const lums = BLOCK_CATEGORIES.map((c) => relativeLuminance(categoryColour(DARK, c)))
    expect(Math.max(...lums) - Math.min(...lums)).toBeLessThan(0.01)
  })

  it('keeps FALLBACK_TOKENS in step with the stylesheet', () => {
    // `readThemeTokens` falls back to these whenever a property reads empty — a
    // detached node, a test, the first frame before the stylesheet lands — so a
    // drifted fallback is a canvas that renders one palette and then another.
    for (const [key, value] of Object.entries(FALLBACK_TOKENS)) {
      expect({ key, value }).toEqual({ key, value: DARK[key as keyof ThemeTokens] })
    }
  })
})

describe('block text clears WCAG AA on every category, in both skins', () => {
  for (const [name, tokens] of SKINS) {
    for (const category of BLOCK_CATEGORIES) {
      it(`${category.id} in ${name}`, () => {
        const fill = categoryColour(tokens, category)
        const ink = readableTextOn(fill)
        expect({ id: category.id, ok: contrastRatio(fill, ink) >= AA }).toEqual({
          id: category.id,
          ok: true
        })
      })
    }
  }

  it('picks ONE ink for the whole palette, which is what makes it look like one', () => {
    // Not an accessibility requirement — a design one. A palette at a single
    // luminance can carry a single ink, and a canvas where some blocks have
    // black text and others white reads as two palettes photographed together.
    const inks = new Set(
      SKINS.flatMap(([, tokens]) =>
        BLOCK_CATEGORIES.map((c) => readableTextOn(categoryColour(tokens, c)))
      )
    )
    expect([...inks]).toEqual(['#ffffff'])
  })
})

describe('the chrome around the blocks', () => {
  for (const [name, tokens] of SKINS) {
    const theme = buildSoftShellTheme(tokens)

    it(`flyout labels are readable in ${name}`, () => {
      // Blockly's own CSS paints these `#000`; the theme manager overrides it
      // with `flyoutForegroundColour`, which is why they are worth asserting
      // rather than assuming — a category heading on the flyout's own card.
      const ink = theme.componentStyles.flyoutForegroundColour
      const paper = theme.componentStyles.flyoutBackgroundColour
      expect({ name, ok: contrastRatio(ink, paper) >= AA }).toEqual({ name, ok: true })
    })

    it(`toolbox labels are readable in ${name}`, () => {
      const ink = theme.componentStyles.toolboxForegroundColour
      const paper = theme.componentStyles.toolboxBackgroundColour
      expect({ name, ok: contrastRatio(ink, paper) >= AA }).toEqual({ name, ok: true })
    })

    it(`the palette never darkens a field in ${name}`, () => {
      // Zelos draws an editable field as an OPAQUE white rect with its own
      // `#575E75` lettering, so a field is readable whatever the block behind
      // it is — the block fill does not blend into it. Asserted rather than
      // assumed because the fix below depends on it being true.
      expect({ name, ok: contrastRatio(ZELOS_FIELD_INK, ZELOS_FIELD_PAPER) >= AA }).toEqual({
        name,
        ok: true
      })
    })
  }
})

/** Zelos's own field colours, from `blockly_compressed.js`'s injected CSS. */
const ZELOS_FIELD_INK = '#575E75'
const ZELOS_FIELD_PAPER = '#ffffff'

describe('the ink rule stops at the edge of a field', () => {
  // THE BUG THIS EXISTS FOR, found by rendering the canvas rather than by any
  // unit test: `--snakie-block-text` is published on the block's SVG group and
  // read by a rule that must out-specify Blockly's `.blocklyText { fill: #fff }`
  // — and out-specifying that rule also out-specifies the field rules sitting
  // beside it in the same stylesheet. Every text field on the canvas went white
  // on an opaque white rect, so a learner's `led` disappeared out of its own
  // `name pin` block while every label around it stayed perfect.
  //
  // A cascade is not something vitest can evaluate, so this asserts the shape of
  // the selector instead: whatever else it does, it must exclude field text.
  // Comments out first, as above: the one before this rule names the very
  // classes the assertions look for.
  const CSS = readFileSync(
    resolve(__dirname, '../src/renderer/src/components/BlocksCanvas.css'),
    'utf8'
  ).replace(/\/\*[\s\S]*?\*\//g, '')

  /** The selector of the rule that paints a block's lettering. */
  const selector = ((): string => {
    for (const [, head, body] of CSS.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (body.includes('--snakie-block-text')) return head.replace(/\s+/g, ' ').trim()
    }
    throw new Error('no rule paints fill from --snakie-block-text')
  })()

  it('excludes field text from the block ink', () => {
    for (const field of ['.blocklyEditableField', '.blocklyNonEditableField']) {
      expect({ field, excluded: selector.includes(`:not(${field} *)`) }).toEqual({
        field,
        excluded: true
      })
    }
  })

  it('still out-specifies Blockly’s own three-class rule', () => {
    // `.zelos-renderer.<theme>-theme .blocklyText` is three classes, and Blockly
    // PREPENDS its stylesheet, so coming later is not enough. The classes inside
    // the `:not()`s are not what carries it past that — the ones outside are.
    const outside = selector.replace(/:not\([^)]*\)/g, '').match(/\.[\w-]+/g) ?? []
    expect({ classes: outside.length > 3 }).toEqual({ classes: true })
  })
})
