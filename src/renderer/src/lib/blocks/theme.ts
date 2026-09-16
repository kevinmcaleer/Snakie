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
export const BLOCK_CATEGORIES = [
  { id: 'turtle', name: 'Turtle', token: 'green' },
  { id: 'hardware', name: 'Hardware', token: 'pinGpio' },
  { id: 'instruments', name: 'Instruments', token: 'num' },
  // The parts on the breadboard bring their own blocks (#1017), grouped one
  // drawer per part. It sits next to Hardware because that is what it IS — the
  // difference is only that nobody hand-wrote these.
  {
    id: 'parts',
    name: 'My parts',
    token: 'pinPower',
    hint: 'Wire a part up in Electronics and its blocks appear here.'
  },
  // Wait gets a category of its own rather than a corner of Control (#1011).
  // It is the single most-used block in any hardware lesson — every blink,
  // every debounce, every "now do the next thing" — and a beginner should not
  // have to know that waiting is a kind of control flow to find it.
  { id: 'wait', name: 'Wait', token: 'gold' },
  { id: 'control', name: 'Control', token: 'gold' },
  { id: 'logic', name: 'Logic', token: 'kw' },
  { id: 'math', name: 'Maths', token: 'num' },
  { id: 'text', name: 'Text', token: 'str' },
  { id: 'lists', name: 'Lists', token: 'str' },
  { id: 'variables', name: 'Variables', token: 'ident' },
  { id: 'functions', name: 'Functions', token: 'kw' },
  {
    id: 'plugins',
    name: 'Plugins',
    token: 'str',
    hint: 'A Python plugin can add blocks here — see Writing plugins.'
  },
  { id: 'python', name: 'Python', token: 'com' }
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
    const colour = tokens[category.token]
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

  // The stock names, pointed at the same colours as the categories they map to.
  for (const [stockStyle, category] of Object.entries(STOCK_STYLE_ALIASES)) {
    const entry = BLOCK_CATEGORIES.find((c) => c.id === category)
    if (entry) blockStyles[stockStyle] = shades(tokens[entry.token])
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
