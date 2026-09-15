import { describe, it, expect } from 'vitest'
import {
  BLOCK_CATEGORIES,
  FALLBACK_TOKENS,
  buildSoftShellTheme,
  categoryStyleName,
  mixHex,
  readThemeTokens,
  softShellWorkspaceOptions
} from '../src/renderer/src/lib/blocks/theme'
import { highlightPython, highlightPythonLine } from '../src/renderer/src/lib/blocks/python-highlight'

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

  it('paints a category with the token it declares — no hard-coded hex', () => {
    for (const c of BLOCK_CATEGORIES) {
      expect(theme.categoryStyles[categoryStyleName(c.id)].colour).toBe(FALLBACK_TOKENS[c.token])
    }
  })

  it('hardware wears the board diagrams\' GPIO colour', () => {
    // The point of the palette: a block and the thing it drives are the same
    // colour everywhere in the app.
    expect(theme.categoryStyles['hardware_category'].colour).toBe(FALLBACK_TOKENS.pinGpio)
    expect(theme.categoryStyles['logic_category'].colour).toBe(FALLBACK_TOKENS.kw)
    expect(theme.categoryStyles['text_category'].colour).toBe(FALLBACK_TOKENS.str)
  })

  it('derives each block\'s three shades rather than hand-picking them', () => {
    const turtle = theme.blockStyles['turtle_blocks']
    expect(turtle.colourPrimary).toBe(FALLBACK_TOKENS.green)
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
    // A silent misparse would produce a plausible-looking WRONG colour.
    expect(mixHex('#abc', '#ffffff', 0.5)).toBe('#abc')
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

/**
 * The Python mirror's colouring (#1009). Not a Python highlighter — a
 * highlighter for the Python WE GENERATE, which is a much smaller language.
 */
describe('highlightPythonLine (#1009)', () => {
  const kinds = (line: string): string => highlightPythonLine(line).map((t) => t.kind).join(' ')
  const text = (line: string, kind: string): string[] =>
    highlightPythonLine(line).filter((t) => t.kind === kind).map((t) => t.text)

  it('colours an import the way the editor does', () => {
    expect(text('from snakie import Led', 'kw')).toEqual(['from', 'import'])
    expect(text('from snakie import Led', 'ident')).toEqual(['snakie', 'Led'])
  })

  it('finds strings, numbers and comments', () => {
    expect(text('led = Led(15)  # pin 15', 'num')).toEqual(['15'])
    expect(text('led = Led(15)  # pin 15', 'com')).toEqual(['# pin 15'])
    expect(text('print("hello")', 'str')).toEqual(['"hello"'])
    expect(text("print('a' + \"b\")", 'str')).toEqual(["'a'", '"b"'])
  })

  it('does not mistake a # inside a string for a comment', () => {
    expect(text('print("# not a comment")', 'str')).toEqual(['"# not a comment"'])
    expect(kinds('print("# not a comment")')).not.toContain('com')
  })

  it('handles an escaped quote', () => {
    expect(text('print("a\\"b")', 'str')).toEqual(['"a\\"b"'])
  })

  it('colours an unterminated string to the end of the line, like every editor', () => {
    expect(text('x = "oops', 'str')).toEqual(['"oops'])
  })

  it('reads floats and hex as one number', () => {
    expect(text('time.sleep(0.5)', 'num')).toEqual(['0.5'])
    expect(text('x = 0xff', 'num')).toEqual(['0xff'])
  })

  it('never drops a character — the line is always reconstructable', () => {
    for (const line of [
      'from snakie import Led',
      '    led.toggle()  # blink',
      'if x >= 3 and y != "a":',
      '',
      '        ',
      'π = "café"'
    ]) {
      expect(highlightPythonLine(line).map((t) => t.text).join('')).toBe(line)
    }
  })
})

describe('highlightPython (#1009)', () => {
  it('is one entry per line, so #1016 has something to address', () => {
    expect(highlightPython('a = 1\nb = 2')).toHaveLength(2)
  })

  it('an empty program is no lines, not one blank one', () => {
    expect(highlightPython('')).toEqual([])
  })
})
