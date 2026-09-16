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
  pinPower: '--pin-power'
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
  pinPower: '#d4553f'
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
 * ONE COLOUR PER CATEGORY, and it did not used to be.
 *
 * The original idea here is a good one and it stays: a block wears the colour
 * its construct has in the CODE MIRROR beside it, so a number block is the blue
 * that `5` is in Monaco. Nothing else in this app can do that, and it is worth
 * more than copying Scratch's palette wholesale.
 *
 * But it was applied to fifteen categories over nine tokens, and measured on the
 * hue wheel the result was worse than the duplicates suggest:
 *
 * ```
 *    8°  logic, functions      (kw)     ─┐ one degree apart
 *    9°  parts                 (pinPower)┘
 *   39°  hardware, wait, control (gold)  ─┐ three degrees apart
 *   42°  text, lists, plugins  (str)     ─┘
 *   89°  python                (com)
 *  107°  modules, variables    (ident)
 *  152°  turtle                (green)
 *  197°  instruments, maths    (num)
 * ```
 *
 * Fifteen drawers in about six telling-apart-able colours, and two of the
 * clashes were between DIFFERENT tokens — so the rule was not even buying the
 * distinctness it cost. A learner cannot tell a Text block from a Hardware one.
 *
 * So `hue` moves a category around the wheel while {@link withHue} keeps the
 * token's saturation and lightness exactly, which is what holds the palette
 * together as one palette. Categories with no `hue` wear their token as before.
 *
 * WHAT KEPT ITS TOKEN, and why those four:
 *
 *  - **maths** is the anchor worth keeping — `num` is literally the colour a
 *    number is in the mirror, and it is the clearest case of the whole idea.
 *    `text` could not keep `str` beside it: the warm end only fits the two board
 *    colours, and `str` was already three degrees off the GPIO dot, so that
 *    anchor was invisible before it moved.
 *  - **turtle** is `green`, the pen colour, and owns that end of the wheel.
 *  - **parts** is `pinPower` and **hardware** is `pinGpio`: the two dot colours
 *    off the board diagrams, so a wired part's blocks match its pin. Hardware
 *    moves 6° to clear `str`, which is not enough to break the resemblance.
 *  - **variables** (`ident`) and **python** (`com`) are near-greys — they take
 *    no hue space at all and are told apart by lightness, so they are left
 *    alone and cost nothing.
 *
 * Everything else is spread at 20° or more. The order below is still the
 * learning order, not the wheel order.
 */
export const BLOCK_CATEGORIES = [
  { id: 'turtle', name: 'Turtle', token: 'green' },
  // 6° off the GPIO dot, purely to clear `str` at 42°. Still reads as the pin.
  { id: 'hardware', name: 'Hardware', token: 'pinGpio', hue: 33 },
  // Teal: the scope/plot family, clear of maths' 197° without leaving the blues.
  { id: 'instruments', name: 'Instruments', token: 'num', hue: 175 },
  // The parts on the breadboard bring their own blocks (#1017), grouped one
  // drawer per part. It sits next to Hardware because that is what it IS — the
  // difference is only that nobody hand-wrote these.
  {
    id: 'parts',
    name: 'My parts',
    token: 'pinPower',
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
    // Violet — and based on `num` rather than `ident` ON PURPOSE. `withHue`
    // keeps saturation, so a hue put on a near-grey stays a near-grey: Modules
    // would have come out the same colour as Variables however far round the
    // wheel it was sent. It needs a saturated token to move at all.
    token: 'num',
    hue: 295,
    hint: 'Import a module and the blocks it offers appear here.'
  },
  // Wait gets a category of its own rather than a corner of Control (#1011).
  // It is the single most-used block in any hardware lesson — every blink,
  // every debounce, every "now do the next thing" — and a beginner should not
  // have to know that waiting is a kind of control flow to find it.
  // Yellow — Scratch puts events here, and waiting is the closest thing to one.
  { id: 'wait', name: 'Wait', token: 'gold', hue: 53 },
  // Olive-gold: next to Wait on the wheel because they were one drawer, far
  // enough from it to be a different one.
  { id: 'control', name: 'Control', token: 'gold', hue: 76 },
  // Indigo. `kw` sat one degree off `pinPower`, so the keyword anchor was
  // already invisible — this buys distinctness the old value never had.
  { id: 'logic', name: 'Logic', token: 'kw', hue: 265 },
  { id: 'math', name: 'Maths', token: 'num' },
  // Blue. `str` sat three degrees off the GPIO dot, so the string anchor was
  // already invisible, and the warm end only fits the two board colours.
  { id: 'text', name: 'Text', token: 'str', hue: 225 },
  // The warm-green gap. Lists began beside Text — a list is a row of things —
  // but five categories in the blues is five nobody can tell apart: the eye
  // separates far less per degree there than it does around the rest of the
  // wheel, so the crowded end gives one up to the empty one.
  { id: 'lists', name: 'Lists', token: 'str', hue: 113 },
  { id: 'variables', name: 'Variables', token: 'ident' },
  // Magenta, a step round from Logic: both are `kw` in the mirror, and keeping
  // them adjacent says so without making them the same block.
  { id: 'functions', name: 'Functions', token: 'kw', hue: 320 },
  {
    id: 'plugins',
    name: 'Plugins',
    token: 'str',
    // Pink, and deliberately the odd one out: a plugin's blocks are the only
    // ones on the canvas that did not ship with Snakie.
    hue: 345,
    hint: 'A Python plugin can add blocks here — see Writing plugins.'
  },
  { id: 'python', name: 'Python', token: 'com' }
] as const satisfies readonly {
  id: string
  name: string
  token: keyof ThemeTokens
  /**
   * Move this category to its own hue, keeping the token's saturation and
   * lightness exactly (see {@link withHue} and the note above the table).
   *
   * Absent means "wear the token as it is", which is what the four anchors do.
   */
  hue?: number
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
 * A category's colour: its token, moved to its own hue when it declares one.
 *
 * Exported because the toolbox and the tests both need to ask the same question
 * the theme asks, and a second copy of this rule is a second palette.
 */
export function categoryColour(
  tokens: ThemeTokens,
  category: { token: keyof ThemeTokens; hue?: number }
): string {
  const colour = tokens[category.token]
  return category.hue === undefined ? colour : withHue(colour, category.hue)
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
 * The same colour, at a different hue (#1007's palette collisions).
 *
 * Saturation and lightness are kept EXACTLY, and that is the whole point: Soft
 * Shell's depth is what makes the palette look like one palette, so a category
 * that needs its own hue should move around the wheel without becoming brighter
 * or flatter than the tokens beside it. Rotating a token's hue keeps a derived
 * colour in the family; picking a fresh hex does not.
 *
 * Anything that is not a 6-digit hex comes back unchanged, like {@link mixHex}.
 */
export function withHue(colour: string, hue: number): string {
  const c = parseHex(colour)
  if (!c) return colour
  const [r, g, b] = c.map((v) => v / 255)
  const mx = Math.max(r, g, b)
  const mn = Math.min(r, g, b)
  const d = mx - mn
  const l = (mx + mn) / 2
  const sat = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1))
  // Standard HSL → RGB, with the hue replaced and S/L carried over untouched.
  const h = ((hue % 360) + 360) % 360
  const chroma = (1 - Math.abs(2 * l - 1)) * sat
  const x = chroma * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = l - chroma / 2
  const seg: [number, number, number] =
    h < 60 ? [chroma, x, 0]
    : h < 120 ? [x, chroma, 0]
    : h < 180 ? [0, chroma, x]
    : h < 240 ? [0, x, chroma]
    : h < 300 ? [x, 0, chroma]
    : [chroma, 0, x]
  const ch = (v: number): string =>
    Math.round(Math.min(255, Math.max(0, (v + m) * 255)))
      .toString(16)
      .padStart(2, '0')
  return `#${ch(seg[0])}${ch(seg[1])}${ch(seg[2])}`
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
  const m = /^#([0-9a-f]{6})$/i.exec(v.trim())
  if (!m) return null
  const n = parseInt(m[1], 16)
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff]
}

/** Narrow a Blockly `Theme` from the spec above (the canvas's one cast). */
export type BlocklyThemeInput = SoftShellThemeSpec & Partial<Theme>
