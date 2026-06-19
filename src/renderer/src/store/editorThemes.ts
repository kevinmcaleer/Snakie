/**
 * Editor colour themes (issue #84)
 * ================================
 *
 * A small, KEYED table of hardcoded editor colour themes for the Skeuomorph
 * ruled-paper editor — each a named set of Monaco token colours plus the paper
 * band / region / empty backgrounds. The Editor tab of the Settings dialog lets
 * the user pick one; the choice is persisted in {@link useEditorSettings} as
 * `editorTheme` and applied two ways that MUST stay in lockstep:
 *
 *   1. Monaco's syntax colours + surface — {@link MonacoEditor} registers one
 *      `monaco.editor.defineTheme` per entry (id → `snakie-editor-<id>`) and
 *      selects the matching one when the Skeuomorph skin is active.
 *   2. The CSS ruled paper — `store/settings.ts` writes the entry's `paperBand`,
 *      `paperRule`, `regionBg` and `dotColor` onto the document root as custom
 *      properties that `index.css` reads, so the lines/dots and editor region
 *      follow the theme without per-theme CSS rules.
 *
 * Designed for EXTENSIBILITY: add a new entry to {@link EDITOR_THEMES} (and it
 * shows up in the selector, registers a Monaco theme, and drives the CSS vars)
 * — no other code changes required.
 *
 * Paper themes keep Monaco's surface transparent so the CSS ruled lines show
 * through and scroll with the text (the historical Skeuomorph behaviour). A
 * theme may instead opt to be OPAQUE + dark (`paper: false`), in which case the
 * ruled lines are intentionally hidden and the bg is painted by Monaco itself
 * (e.g. `midnight`); the ruled-line ALIGNMENT is unaffected either way because
 * the line height still equals `--editor-rule-spacing`.
 */

/** A single Monaco token colour rule (subset of monaco's ITokenThemeRule). */
export interface EditorTokenRule {
  token: string
  foreground?: string
  fontStyle?: string
}

/** One named editor colour theme. */
export interface EditorThemeDef {
  /** Stable id, also the localStorage value + the Monaco/`data-` suffix. */
  id: string
  /** Human label shown in the Settings selector. */
  label: string
  /** Short description shown under the selector. */
  hint: string
  /**
   * `true`  → paper theme: Monaco surface is transparent, CSS paints the ruled
   *           lines (use `paperBand`/`paperRule`/`dotColor`).
   * `false` → opaque dark theme: Monaco paints `monaco.editorBackground`, the
   *           CSS ruled lines are hidden.
   */
  paper: boolean
  /** Editor region + empty-state background (CSS). */
  regionBg: string
  /** Ruled-paper band colour — the lit area between rules (CSS). */
  paperBand: string
  /** Ruled-line colour (CSS). */
  paperRule: string
  /** Dot colour for the squared-dots paper mode (CSS, may be rgba). */
  dotColor: string
  /** Red margin rule colour (CSS). */
  marginRule: string
  /** Monaco editor surface colours. */
  monaco: {
    background: string
    gutterBackground: string
    lineNumber: string
    lineNumberActive: string
    foreground: string
    selection: string
    lineHighlight: string
    minimap: string
    widget: string
  }
  /** Monaco token colour rules — the syntax highlighter (issue #84). */
  rules: EditorTokenRule[]
}

/**
 * Shared, richer Python token rules: keywords, strings, numbers, comments,
 * types, functions/identifiers and operators all clearly distinct (issue #84).
 * Each theme supplies its own palette via this factory so the SET of tokens it
 * colours stays consistent across themes.
 */
function buildRules(palette: {
  keyword: string
  control: string
  string: string
  stringEscape: string
  number: string
  comment: string
  type: string
  func: string
  decorator: string
  constant: string
  identifier: string
  operator: string
  delimiter: string
}): EditorTokenRule[] {
  return [
    // Keywords (def, class, import, return, …) — bold, the loudest token.
    { token: 'keyword', foreground: palette.keyword, fontStyle: 'bold' },
    { token: 'keyword.python', foreground: palette.keyword, fontStyle: 'bold' },
    // Control-flow keywords (if/for/while/try) get their own accent.
    { token: 'keyword.flow', foreground: palette.control, fontStyle: 'bold' },
    { token: 'keyword.control', foreground: palette.control, fontStyle: 'bold' },
    // Strings + escapes.
    { token: 'string', foreground: palette.string },
    { token: 'string.python', foreground: palette.string },
    { token: 'string.escape', foreground: palette.stringEscape },
    { token: 'string.escape.python', foreground: palette.stringEscape },
    // Numbers (int/float/hex).
    { token: 'number', foreground: palette.number },
    { token: 'number.python', foreground: palette.number },
    { token: 'number.hex', foreground: palette.number },
    { token: 'number.float', foreground: palette.number },
    // Comments — italic, quiet.
    { token: 'comment', foreground: palette.comment, fontStyle: 'italic' },
    { token: 'comment.python', foreground: palette.comment, fontStyle: 'italic' },
    // Types / classes.
    { token: 'type', foreground: palette.type },
    { token: 'type.identifier', foreground: palette.type },
    { token: 'type.identifier.python', foreground: palette.type },
    // Functions / called identifiers.
    { token: 'function', foreground: palette.func },
    { token: 'identifier.function', foreground: palette.func },
    { token: 'support.function', foreground: palette.func },
    // Decorators (@property).
    { token: 'tag', foreground: palette.decorator },
    { token: 'annotation', foreground: palette.decorator },
    { token: 'meta.decorator', foreground: palette.decorator },
    // Constants (True/False/None/self).
    { token: 'constant', foreground: palette.constant },
    { token: 'constant.language', foreground: palette.constant },
    { token: 'variable.predefined', foreground: palette.constant },
    // Plain identifiers / variables.
    { token: 'identifier', foreground: palette.identifier },
    { token: 'variable', foreground: palette.identifier },
    // Operators (+ - = ==) and delimiters (brackets/commas).
    { token: 'operator', foreground: palette.operator },
    { token: 'operators', foreground: palette.operator },
    { token: 'delimiter', foreground: palette.delimiter },
    { token: 'delimiter.bracket', foreground: palette.delimiter },
    { token: 'delimiter.parenthesis', foreground: palette.delimiter },
    { token: 'delimiter.square', foreground: palette.delimiter }
  ]
}

/**
 * The editor-theme table (id → definition). The KEY is the persisted value and
 * the Monaco / `data-editor-theme` suffix. Add entries here to extend.
 */
export const EDITOR_THEMES: Record<string, EditorThemeDef> = {
  // The historical warm cream paper (concept 08): rust keywords, moss strings,
  // amber numbers, plum classes, slate types. The default.
  paper: {
    id: 'paper',
    label: 'Paper',
    hint: 'Warm cream notebook, ink-on-paper syntax',
    paper: true,
    regionBg: '#e9e3d2',
    paperBand: '#f6f1e3',
    paperRule: '#e0d4b2',
    dotColor: 'rgba(176, 150, 96, 0.22)',
    marginRule: '#d98a8a',
    monaco: {
      background: '#00000000',
      gutterBackground: '#00000000',
      lineNumber: '#b8ad8c',
      lineNumberActive: '#8a3b2f',
      foreground: '#2a2620',
      selection: '#d9c79a',
      lineHighlight: '#00000000',
      minimap: '#efe9d7',
      widget: '#e9e3d2'
    },
    rules: buildRules({
      keyword: '8a3b2f', // rust
      control: 'a14a26', // burnt orange
      string: '4a6b3a', // moss
      stringEscape: '2f7a52',
      number: '9a6b2f', // amber
      comment: '9a9075', // faded
      type: '5a4a8a', // plum/slate
      func: '2f5a7a', // steel blue
      decorator: '8a6a1e', // brass
      constant: '7a3b6a', // mauve
      identifier: '2a2620', // ink
      operator: '5a544a',
      delimiter: '5a544a'
    })
  },
  // Whiter paper with VIVID, high-contrast syntax so the colours pop (issue #84).
  bright: {
    id: 'bright',
    label: 'Bright',
    hint: 'Whiter paper with vivid, high-contrast syntax',
    paper: true,
    regionBg: '#f3f1e6',
    paperBand: '#fbfbf6', // whiter off-white band
    paperRule: '#dfe0d2', // subtle rule
    dotColor: 'rgba(120, 130, 150, 0.20)',
    marginRule: '#e06a6a',
    monaco: {
      background: '#00000000',
      gutterBackground: '#00000000',
      lineNumber: '#b9bcae',
      lineNumberActive: '#0a5ad6',
      foreground: '#1c1d22',
      selection: '#cfe2ff',
      lineHighlight: '#00000000',
      minimap: '#f7f6ee',
      widget: '#f3f1e6'
    },
    rules: buildRules({
      keyword: '0b54c4', // vivid blue
      control: 'b21e8c', // magenta
      string: '0a7d3f', // green
      stringEscape: '0a8f6a',
      number: 'c4500a', // orange
      comment: '8a8f7a', // muted olive
      type: '7d18b8', // purple
      func: '0a63a6', // azure
      decorator: 'b07d0a', // gold
      constant: 'c41e6a', // pink-red
      identifier: '1c1d22', // near black
      operator: '6a3aa0', // violet
      delimiter: '5b5d52'
    })
  },
  // Dark variant — opaque surface, ruled lines intentionally hidden (issue #84).
  midnight: {
    id: 'midnight',
    label: 'Midnight',
    hint: 'Dark editor (ruled lines hidden)',
    paper: false,
    regionBg: '#12131a',
    paperBand: '#12131a',
    paperRule: '#1d1f2b',
    dotColor: 'rgba(120, 130, 170, 0.16)',
    marginRule: '#5a3b3b',
    monaco: {
      background: '#161823',
      gutterBackground: '#161823',
      lineNumber: '#5a5f73',
      lineNumberActive: '#cdd3ea',
      foreground: '#d7dbe8',
      selection: '#2c3350',
      lineHighlight: '#1d2030',
      minimap: '#12131a',
      widget: '#1e2130'
    },
    rules: buildRules({
      keyword: 'c792ea', // lilac
      control: 'f78c6c', // coral
      string: 'c3e88d', // lime
      stringEscape: '89ddff',
      number: 'f78c6c', // coral
      comment: '6a7390', // slate
      type: 'ffcb6b', // amber
      func: '82aaff', // blue
      decorator: 'ffcb6b', // amber
      constant: 'f07178', // salmon
      identifier: 'd7dbe8', // light
      operator: '89ddff', // cyan
      delimiter: '8b93b0'
    })
  }
}

/**
 * Syntax rules for the Dark Skeuomorph editor (issue #91). The dark skin renders
 * the ruled-paper editor on a deep-slate "paper" with a TRANSPARENT Monaco
 * surface (see `snakie-dark` in MonacoEditor) so the CSS ruled lines show
 * through — the dark twin of the light `paper` theme. This palette mirrors the
 * Midnight editor theme so the syntax reads legibly on the dark paper.
 */
export const DARK_PAPER_RULES: EditorTokenRule[] = buildRules({
  keyword: 'c792ea', // lilac
  control: 'f78c6c', // coral
  string: 'c3e88d', // lime
  stringEscape: '89ddff',
  number: 'f78c6c', // coral
  comment: '6f7896', // slate
  type: 'ffcb6b', // amber
  func: '82aaff', // blue
  decorator: 'ffcb6b', // amber
  constant: 'f07178', // salmon
  identifier: 'd4d8e0', // light ink
  operator: '89ddff', // cyan
  delimiter: '8b93b0'
})

/** The default editor theme id (the warm cream paper). */
export const DEFAULT_EDITOR_THEME = 'paper'

/** All editor theme defs in display order. */
export const EDITOR_THEME_LIST: EditorThemeDef[] = Object.values(EDITOR_THEMES)

/** Resolve a theme id to its def, falling back to the default. */
export function editorThemeFor(id: string): EditorThemeDef {
  return EDITOR_THEMES[id] ?? EDITOR_THEMES[DEFAULT_EDITOR_THEME]
}

/** The Monaco theme name registered for an editor-theme id. */
export function monacoThemeName(id: string): string {
  return `snakie-editor-${editorThemeFor(id).id}`
}
