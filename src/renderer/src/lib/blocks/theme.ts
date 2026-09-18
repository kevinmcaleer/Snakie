/**
 * THE SOFT SHELL BLOCKLY THEME (#1009, epic #1007 / epic #573).
 * =============================================================================
 *
 * Blockly paints blocks as SVG fills, so it needs real colour VALUES at inject
 * time — a `var(--panel)` in a theme object renders as nothing. But Soft Shell's
 * whole rule (epic #859) is that colour lives in the CSS custom properties and
 * both skins come from the same source, so hard-coding hex here would mean a
 * canvas that stays dark when the app turns to parchment.
 *
 * So the theme is built in two halves:
 *
 *  - {@link readThemeTokens} reads the computed custom properties off a live
 *    element. That is the only part that needs a DOM, and it is three lines.
 *  - {@link buildSoftShellTheme} maps those tokens onto Blockly's theme shape.
 *    Pure, so the mapping — which is the part with opinions in it — is unit
 *    tested rather than eyeballed in a screenshot.
 *
 * The canvas re-reads and re-applies on a `data-theme` change, the same
 * MutationObserver pattern `Terminal.tsx` and `RobotView.tsx` already use.
 *
 * CATEGORY COLOURS. Blockly's stock palette is the bright primary set Scratch
 * made famous, and dropped into warm parchment it looks like a different
 * application embedded in ours. These instead come from the tokens the rest of
 * Snakie already uses, chosen so each category reads as the thing it drives:
 * hardware takes the GPIO pin colour off the board diagrams, control takes the
 * gold that already means "the app is doing something", logic takes the syntax
 * keyword colour, and so on. The result is that a block and the line of Python
 * it generates are, deliberately, the same colour.
 */
import type { BlocklyOptions, Theme } from 'blockly'

/**
 * The Soft Shell tokens the canvas needs, as concrete colour strings.
 *
 * A subset of `index.css` — every one already exists and is defined in BOTH
 * skins, so nothing here introduces a colour the design doesn't have.
 */
export interface ThemeTokens {
  /** Surfaces. */
  editor: string
  panel: string
  card: string
  line: string
  gutter: string
  /** Text. */
  head: string
  txt2: string
  /** Accents. */
  green: string
  gold: string
  /** Syntax — the categories borrow these so a block matches its own Python. */
  kw: string
  str: string
  num: string
  com: string
  ident: string
  /** The GPIO pin dot from the board diagrams — hardware blocks wear it. */
  pinGpio: string
  /** The POWER pin dot — worn by the blocks a wired-up part brings with it. */
  pinPower: string
  /**
   * THE BLOCK PALETTE (#1098, #1099) — one colour per category, and the only
   * colours on this canvas that are not borrowed from somewhere else.
   *
   * They used to be: a block wore the token its construct has in the CODE
   * MIRROR, so a number block was the blue `5` is in Monaco. A lovely idea, and
   * it had a contract inversion inside it — those tokens are FOREGROUND colours,
   * picked to be readable *on* the editor background, and a foreground re-used
   * as a fill inverts with the skin. The dark theme got light blocks with white
   * text (eleven of fifteen categories below 3.0:1) and parchment got dark ones.
   *
   * So the palette is its own thing now: **one set of fills for both skins, with
   * only the canvas behind them changing**, which is what Scratch and MakeCode
   * do. Every one sits at the same measured LUMINANCE, so white text is 5.2:1 on
   * all of them — see the note in `index.css` for why luminance and not HSL
   * lightness.
   */
  blockTurtle: string
  blockHardware: string
  blockInstruments: string
  blockParts: string
  blockModules: string
  blockWait: string
  blockControl: string
  blockLogic: string
  blockMath: string
  blockText: string
  blockLists: string
  blockVariables: string
  blockFunctions: string
  blockPlugins: string
  blockPython: string
}

/** The custom property each token comes from. */
const TOKEN_VARS: Record<keyof ThemeTokens, string> = {
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

/**
 * The dark skin's values, used when a property reads back empty.
 *
 * Not a second palette to maintain — a floor. `getComputedStyle` returns `''`
 * for a property that isn't set yet (a detached node, a test, the first frame
 * before the stylesheet lands), and a Blockly theme built from empty strings
 * renders invisible blocks. Every one of these is the value `index.css` gives
 * the token under `:root`.
 */
export const FALLBACK_TOKENS: ThemeTokens = {
  editor: '#191c15',
  panel: '#21251f',
  card: '#262a21',
  line: '#2a2e22',
  gutter: '#15180f',
  head: '#eef1ea',
  txt2: '#9a9d8f',
  green: '#26a269',
  gold: '#d9a441',
  kw: '#e08b7d',
  str: '#d8b96e',
  num: '#7fc4e0',
  com: '#6f7a63',
  ident: '#cdd4cb',
  pinGpio: '#d9a441',
  pinPower: '#d4553f',
  // The block palette, which is the SAME in both skins — see `index.css`.
  blockTurtle: '#167d38',
  blockHardware: '#985f1b',
  blockInstruments: '#157965',
  blockParts: '#c63923',
  blockModules: '#b223c9',
  blockWait: '#766d15',
  blockControl: '#4e7715',
  blockLogic: '#8c45de',
  blockMath: '#2b66da',
  blockText: '#6158e1',
  blockLists: '#227d16',
  blockVariables: '#1a7595',
  blockFunctions: '#c22298',
  blockPlugins: '#cd2457',
  blockPython: '#676e60'
}

/** Read the live Soft Shell tokens off `el` (normally the document root). */
export function readThemeTokens(el: Element | null): ThemeTokens {
  if (!el || typeof getComputedStyle !== 'function') return { ...FALLBACK_TOKENS }
  const style = getComputedStyle(el)
  const out = {} as ThemeTokens
  for (const [key, cssVar] of Object.entries(TOKEN_VARS) as [keyof ThemeTokens, string][]) {
    const value = style.getPropertyValue(cssVar).trim()
    out[key] = value || FALLBACK_TOKENS[key]
  }
  return out
}

/**
 * The toolbox categories, in palette order, and the token each is painted with.
 *
 * Order is the learning order, not the alphabet: a child opens the toolbox and
 * the first thing they can reach should make the turtle move (#1013). The block
 * issues later in the epic fill these in — this is the list they populate, and
 * it lives here so the colour and the category can never disagree.
 */
/**
 * ONE COLOUR PER CATEGORY, AND THE PALETTE IS ITS OWN THING (#1098, #1099).
 *
 * The original idea here was a good one and it is gone: a block wore the colour
 * its construct has in the CODE MIRROR, so a number block was the blue `5` is in
 * Monaco. Nothing else in this app can do that, and it was worth trying.
 *
 * WHAT IT COST. Those tokens are FOREGROUND colours — `--kw`, `--num`, `--ident`
 * are picked to be readable *on* the editor background — and a foreground used
 * as a FILL inverts with the skin. The dark theme got pale blocks, parchment got
 * dark ones, and within a single skin the lightness ran from 20% to 81%. Blockly
 * paints block text white and a theme cannot change it, so eleven of the fifteen
 * categories were under 3.0:1 in the dark skin and Variables was at 1.51:1 — a
 * near-white block with near-white text on it, which is what reported #1099.
 *
 * Two hues also collided so hard that the rule was not even buying the
 * distinctness it cost: `logic`/`functions` (`kw`) sat one degree from `parts`
 * (`pinPower`), and `hardware`/`wait`/`control` (`gold`) three degrees from
 * `text`/`lists` (`str`). Fifteen drawers in about six telling-apart-able
 * colours. A `hue:` per category was layered on to fix that, and it could not
 * fix the near-greys at all: `withHue` keeps saturation, so a hue put on
 * `ident` stays a near-grey however far round the wheel it is sent.
 *
 * SO THE BLOCKS GET A PALETTE OF THEIR OWN — one set of fills for BOTH skins,
 * with only the canvas behind them changing, which is what Scratch and MakeCode
 * do and what makes their canvases read as one thing. It lives in `index.css`
 * with the rest of the colour, at one measured luminance so that white text is
 * 5.2:1 on every block, with the hues spread ~24° apart and anchored where the
 * brand palette already has an opinion.
 *
 * The order below is still the LEARNING order, not the wheel order: a child
 * opens the toolbox and the first thing they can reach should make the turtle
 * move (#1013).
 */
export const BLOCK_CATEGORIES = [
  { id: 'turtle', name: 'Turtle', token: 'blockTurtle' },
  { id: 'hardware', name: 'Hardware', token: 'blockHardware' },
  { id: 'instruments', name: 'Instruments', token: 'blockInstruments' },
  // The parts on the breadboard bring their own blocks (#1017), grouped one
  // drawer per part. It sits next to Hardware because that is what it IS — the
  // difference is only that nobody hand-wrote these.
  {
    id: 'parts',
    name: 'My parts',
    token: 'blockParts',
    hint: 'Wire a part up in Electronics and its blocks appear here.'
  },
  // The modules this program IMPORTS (#1048), one drawer each.
  //
  // NOT "My parts", and the distinction earns its keep: that one means things
  // on your breadboard, it is populated from the wiring, and its empty-state
  // hint says so. An arbitrary `import ssd1306` is not a thing on a breadboard.
  {
    id: 'modules',
    name: 'Modules',
    token: 'blockModules',
    hint: 'Import a module and the blocks it offers appear here.'
  },
  // Wait gets a category of its own rather than a corner of Control (#1011).
  // It is the single most-used block in any hardware lesson — every blink,
  // every debounce, every "now do the next thing" — and a beginner should not
  // have to know that waiting is a kind of control flow to find it.
  { id: 'wait', name: 'Wait', token: 'blockWait' },
  { id: 'control', name: 'Control', token: 'blockControl' },
  { id: 'logic', name: 'Logic', token: 'blockLogic' },
  { id: 'math', name: 'Maths', token: 'blockMath' },
  { id: 'text', name: 'Text', token: 'blockText' },
  { id: 'lists', name: 'Lists', token: 'blockLists' },
  // The brand blue (#1098). It used to wear `ident`, a near-grey in both skins,
  // so the drawer read as black on parchment and as white in the dark — which
  // is the screenshot that opened the issue.
  { id: 'variables', name: 'Variables', token: 'blockVariables' },
  { id: 'functions', name: 'Functions', token: 'blockFunctions' },
  {
    id: 'plugins',
    name: 'Plugins',
    token: 'blockPlugins',
    hint: 'A Python plugin can add blocks here — see Writing plugins.'
  },
  { id: 'python', name: 'Python', token: 'blockPython' }
] as const satisfies readonly {
  id: string
  name: string
  token: keyof ThemeTokens
  /**
   * What an EMPTY category says (#1017).
   *
   * The fixed categories are shown empty on purpose — an empty `Turtle` says
   * "turtle blocks go here". But a category that is empty because the learner
   * has not done something yet can say what that something IS, which turns a
   * dead drawer into the one instruction that fills it.
   */
  hint?: string
}[]

export type BlockCategoryId = (typeof BLOCK_CATEGORIES)[number]['id']

/** `categoryStyles` keyed the way Blockly wants them (`<id>_category`). */
export function categoryStyleName(id: BlockCategoryId): string {
  return `${id}_category`
}

/**
 * Build the Blockly theme from a set of tokens. Pure — no DOM, no Blockly.
 *
 * Typed loosely as the shape Blockly's `Theme.defineTheme` accepts rather than
 * the class itself, so this stays importable by a node test that has no
 * intention of loading a multi-megabyte UI library.
 */
export interface SoftShellThemeSpec {
  name: string
  base?: string
  blockStyles: Record<
    string,
    { colourPrimary: string; colourSecondary: string; colourTertiary: string; hat?: string }
  >
  categoryStyles: Record<string, { colour: string }>
  componentStyles: Record<string, string>
  fontStyle: { family: string; weight: string; size: number }
  startHats: boolean
}

/**
 * Blockly's OWN block-style names, mapped onto our categories.
 *
 * The core palette (#1011) uses Blockly's stock `controls_if`,
 * `math_arithmetic` and friends, which carry style names from its classic
 * theme. Without these aliases they would fall back to Blockly's bright primary
 * palette and a canvas full of them would look like a different application
 * embedded in ours.
 */
const STOCK_STYLE_ALIASES: Record<string, BlockCategoryId> = {
  loop_blocks: 'control',
  logic_blocks: 'logic',
  math_blocks: 'math',
  text_blocks: 'text',
  list_blocks: 'lists',
  colour_blocks: 'math',
  variable_blocks: 'variables',
  variable_dynamic_blocks: 'variables',
  procedure_blocks: 'functions',
  hat_blocks: 'control'
}

/**
 * A category's colour: the token it declares, and nothing else.
 *
 * It used to rotate that token to a `hue:` the category declared, because
 * fifteen drawers were sharing nine syntax tokens and colliding (see the note
 * above `BLOCK_CATEGORIES`). The palette is its own set of colours now, one per
 * category, so there is nothing left to rotate — and a category that wants a
 * different colour changes a token in `index.css` rather than a number here.
 *
 * Still exported, and still one function, because the toolbox and the tests both
 * need to ask the same question the theme asks: a second copy of this rule would
 * be a second palette.
 */
export function categoryColour(
  tokens: ThemeTokens,
  category: { token: keyof ThemeTokens }
): string {
  return tokens[category.token]
}

export function buildSoftShellTheme(tokens: ThemeTokens): SoftShellThemeSpec {
  const blockStyles: SoftShellThemeSpec['blockStyles'] = {}
  const categoryStyles: SoftShellThemeSpec['categoryStyles'] = {}
  const shades = (colour: string): SoftShellThemeSpec['blockStyles'][string] => ({
    colourPrimary: colour,
    // Blockly wants three shades per block (body, shadow/inline field, edge).
    // Deriving them keeps the palette one colour per category rather than
    // thirty-three hand-picked hexes that drift apart the first time the
    // design changes.
    colourSecondary: mixHex(colour, tokens.card, 0.45),
    colourTertiary: mixHex(colour, tokens.gutter, 0.35)
  })

  for (const category of BLOCK_CATEGORIES) {
    const colour = categoryColour(tokens, category)
    categoryStyles[categoryStyleName(category.id)] = { colour }
    blockStyles[`${category.id}_blocks`] = {
      colourPrimary: colour,
      // Blockly wants three shades per block (body, shadow/inline field, edge).
      // Deriving them keeps the palette one colour per category rather than
      // thirty-three hand-picked hexes that drift apart the first time the
      // design changes.
      colourSecondary: mixHex(colour, tokens.card, 0.45),
      colourTertiary: mixHex(colour, tokens.gutter, 0.35)
    }
  }

  // COMMENTS ARE NOT CODE (#1062), so they do not wear the Python category's
  // colour — which, awkwardly, is already the COMMENT token, so "paint comments
  // the comment colour" would have made them identical to the raw-Python blocks
  // they sit among. A thirty-line header rendered at the weight of the program
  // dominates the canvas — the "wall of comments" the issue reported — and the
  // fix is the one every editor already made: let a note RECEDE.
  //
  // So: the comment colour with the COLOUR TAKEN OUT. Soft Shell is a warm
  // palette, so anything mixed within it stays warm and reads as another kind
  // of code; a true neutral is the only thing on this canvas that is not trying
  // to be a category, which is exactly what a comment is.
  blockStyles.comment_blocks = shades(greyOf(tokens.com))

  // The stock names, pointed at the same colours as the categories they map to.
  for (const [stockStyle, category] of Object.entries(STOCK_STYLE_ALIASES)) {
    const entry = BLOCK_CATEGORIES.find((c) => c.id === category)
    if (entry) blockStyles[stockStyle] = shades(categoryColour(tokens, entry))
  }

  return {
    name: 'snakie-soft-shell',
    base: 'classic',
    blockStyles,
    categoryStyles,
    componentStyles: {
      workspaceBackgroundColour: tokens.editor,
      toolboxBackgroundColour: tokens.panel,
      toolboxForegroundColour: tokens.head,
      flyoutBackgroundColour: tokens.card,
      flyoutForegroundColour: tokens.txt2,
      flyoutOpacity: '1',
      scrollbarColour: tokens.line,
      scrollbarOpacity: '0.6',
      insertionMarkerColour: tokens.gold,
      insertionMarkerOpacity: '0.7',
      markerColour: tokens.gold,
      cursorColour: tokens.gold,
      selectedGlowColour: tokens.gold,
      gridColour: tokens.line
    },
    // Plus Jakarta Sans — Soft Shell's UI face — on block text. The mono face
    // belongs inside code FIELDS, which is a per-field style, not a theme one.
    // 12, not Blockly's 11: the blocks got roomier (see `renderer.ts`) and text
    // that stayed put would have read as a small label floating in a large
    // shape. This is also the size Blockly writes into the renderer's
    // `FIELD_TEXT_FONTSIZE`, so the field boxes are measured around it.
    fontStyle: { family: 'Plus Jakarta Sans, system-ui, sans-serif', weight: '600', size: 12 },
    // A hat on every top-level block: it is the visual that says "programs start
    // here", which is the single most useful thing the canvas can tell a child
    // who has only ever seen Scratch's "when green flag clicked".
    startHats: true
  }
}

/** The workspace options that don't depend on the theme (grid, zoom, trashcan). */
/**
 * The Soft Shell renderer's registered name (#573).
 *
 * Declared HERE, with the options that name it, rather than imported from
 * `renderer.ts` — this module is deliberately Blockly-free so the golden-file
 * theme tests can run in plain node, and `renderer.ts` subclasses Blockly's own
 * classes. The dependency points that way instead.
 */
export const SOFT_SHELL_RENDERER = 'snakie-soft-shell'

/**
 * The custom property a block's own text colour is published on (#1099).
 *
 * The renderer sets it on each block's SVG group and `BlocksCanvas.css` reads it
 * with `fill: var(…)`. A custom property INHERITS down the SVG tree, so a
 * block's labels pick it up and a nested block overrides it for its own subtree
 * — which is the whole mechanism, and it needs no per-block class, no walk of
 * the canvas, and nothing that has to be re-run when Blockly re-renders.
 *
 * Named in one place because two files have to agree on the string.
 */
export const BLOCK_TEXT_VAR = '--snakie-block-text'

export function softShellWorkspaceOptions(tokens: ThemeTokens): Partial<BlocklyOptions> {
  return {
    // Thrasos's row layout, wearing the Soft Shell geometry — rounder corners
    // and room around a field. `installSoftShellRenderer()` must have run.
    renderer: SOFT_SHELL_RENDERER,
    grid: { spacing: 24, length: 3, colour: tokens.line, snap: true },
    zoom: {
      controls: true,
      wheel: true,
      startScale: 0.9,
      maxScale: 3,
      minScale: 0.3,
      scaleSpeed: 1.1
    },
    move: { scrollbars: { horizontal: true, vertical: true }, drag: true, wheel: true },
    trashcan: true,
    // A click noise per block placement is not what a room of thirty children
    // needs, and it is the only thing in Blockly's media folder we then don't
    // have to ship.
    sounds: false,
    // RELATIVE, so it resolves against the document in both hosts: `file://…`
    // in the packaged desktop app and the site root on the web. Blockly's own
    // default is a CDN, which the app's `img-src 'self' data:` CSP refuses and
    // an offline classroom can't reach — see `vite-plugin-blockly-media.ts`.
    media: 'blockly-media/'
  }
}

/**
 * Blend two `#rrggbb` colours, `t` of the way from `a` to `b`.
 *
 * Deliberately only understands 6-digit hex: every token this touches is one,
 * and a silent misparse of some other notation would produce a plausible-looking
 * wrong colour rather than an obvious failure. Anything else comes back as `a`.
 */
/**
 * The same brightness, with the colour taken out (#1062).
 *
 * Rec. 601 luma, which is the weighting that matches how the eye reads
 * brightness — a naive average of the channels turns a mid green noticeably
 * darker than the mid red beside it, and the whole point here is that the grey
 * should sit at the same visual depth as the token it came from.
 *
 * Anything that is not a 6-digit hex comes back unchanged, like {@link mixHex}.
 */
export function greyOf(colour: string): string {
  const c = parseHex(colour)
  if (!c) return colour
  const y = Math.round(0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2])
  const h = Math.min(255, Math.max(0, y)).toString(16).padStart(2, '0')
  return `#${h}${h}${h}`
}

/**
 * READABLE TEXT ON A FILL (#1099).
 * ---------------------------------------------------------------------------
 *
 * Blockly hardcodes `.blocklyText { fill: #fff }` and nothing computed a
 * different one, so **block text was white on every block in both skins** —
 * and measured against the categories, eleven of fifteen were below 3.0:1 in
 * the dark skin, with Variables at 1.51:1.
 *
 * THE ROOT CAUSE IS A CONTRACT INVERSION, and it is worth naming because it
 * explains why this is one function rather than fifteen hand-tuned colours: the
 * Soft Shell tokens are SYNTAX HIGHLIGHT colours — foregrounds, picked to be
 * readable ON the editor background — and the block theme uses them as block
 * FILLS. In the dark skin those foregrounds are light by design, so the result
 * was a light block with white text on it.
 *
 * So the text colour is derived from the fill instead of assumed: whichever of
 * black and white contrasts better with it. That fixes every category in both
 * skins at once, and — the part no per-category table could do — every block a
 * part (#1017) or a plugin contributes, and every category added later.
 *
 * WCAG relative luminance, and the 4.5:1 bar that goes with it: block text is
 * 12px at weight 600, which is *normal* text for WCAG, so the large-bold
 * exemption of 3.0:1 does not apply.
 */
export function readableTextOn(fill: string): string {
  const onWhite = contrastRatio(fill, '#ffffff')
  const onBlack = contrastRatio(fill, '#000000')
  // Ties go to white, which is what Blockly did before this and what the
  // darker half of the palette wants anyway.
  return onWhite >= onBlack ? '#ffffff' : '#000000'
}

/** The WCAG contrast ratio between two `#rrggbb` colours, 1 to 21. */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

/**
 * WCAG 2.x relative luminance. Anything that is not a 6-digit hex reads as
 * black, which is the safe end: it makes a colour we cannot parse ask for white
 * text rather than silently claiming a contrast nobody measured.
 */
export function relativeLuminance(colour: string): number {
  const c = parseHex(colour)
  if (!c) return 0
  const [r, g, b] = c.map((v) => {
    const s = v / 255
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

export function mixHex(a: string, b: string, t: number): string {
  const ca = parseHex(a)
  const cb = parseHex(b)
  if (!ca || !cb) return a
  const k = Math.min(1, Math.max(0, t))
  const ch = (i: number): string =>
    Math.round(ca[i] + (cb[i] - ca[i]) * k)
      .toString(16)
      .padStart(2, '0')
  return `#${ch(0)}${ch(1)}${ch(2)}`
}

function parseHex(v: string): [number, number, number] | null {
  // THREE DIGITS COUNT TOO (#1099). `index.css` writes `--card: #fff`, and a
  // parser that only understood six silently reported it as BLACK — which made
  // `readableTextOn` ask for white text on a white surface, and a contrast test
  // measure 3.2:1 where the real figure is 6.5:1. Both notations are the same
  // notation; anything else still comes back null, which is what keeps a
  // misparse of some other format an obvious failure rather than a plausible
  // wrong colour.
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(v.trim())
  if (!m) return null
  const full = m[1].length === 3 ? m[1].replace(/./g, (c) => c + c) : m[1]
  const n = parseInt(full, 16)
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff]
}

/** Narrow a Blockly `Theme` from the spec above (the canvas's one cast). */
export type BlocklyThemeInput = SoftShellThemeSpec & Partial<Theme>
