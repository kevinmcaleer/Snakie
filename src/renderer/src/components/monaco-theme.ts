import * as monaco from 'monaco-editor/esm/vs/editor/editor.api'
import { DARK_PAPER_RULES, EDITOR_THEME_LIST, monacoThemeName } from '../store/editorThemes'

/**
 * THE EDITOR'S LOOK, IN ONE PLACE.
 * =============================================================================
 *
 * Extracted from `MonacoEditor.tsx` (#1010, epic #1007) when the blocks split
 * gained a second Monaco — the read-only Python mirror beside the canvas.
 *
 * The requirement on that mirror is "the same theme and font as the editor", and
 * the only way to be sure of that is for there to be one implementation of what
 * the theme and the font ARE. Two copies would agree on the day they were
 * written and drift the first time someone adds an editor colour theme, leaving
 * a mirror that is subtly the wrong colour next to the editor it mirrors.
 *
 * Nothing here is new behaviour; it is the same code, addressable by both.
 */

/** Read the app's authoritative skin from the document root (set by useTheme on
 * every theme change). Reading this — rather than a separate useTheme() instance
 * — guarantees the editor always matches the visible app theme. */
export function readDocTheme(): string {
  return document.documentElement.getAttribute('data-theme') ?? 'dark'
}

/** Read the user's editor colour-theme id from the document root (set by the
 * settings store), so the create/observe effects can resolve the Monaco theme
 * without a fresh useEditorSettings() instance racing the attribute. */
export function readEditorTheme(): string {
  return document.documentElement.getAttribute('data-editor-theme') ?? 'paper'
}

let themesDefined = false

/** Define Monaco themes whose backgrounds match the app's palette so the editor
 * blends into the surrounding UI instead of showing Monaco's defaults. The
 * Skeuomorph skin's editor colours come from the keyed editor-theme table
 * (store/editorThemes, issue #84) — one Monaco theme per entry, so adding a
 * theme there registers it here for free. */
export function ensureMonacoThemes(): void {
  if (themesDefined) return
  themesDefined = true
  // Dark Skeuomorph editor (issue #91): the dark variant of the ruled-paper
  // editor. Monaco's surface is TRANSPARENT so the CSS deep-slate ruled paper
  // (`.lines-content` under `data-theme='dark'` in index.css) shows through and
  // scrolls with the text — exactly like the light Skeuomorph `paper` theme.
  // The syntax palette mirrors the Midnight editor theme so it reads legibly on
  // the dark paper, with a matching transparent gutter/line-highlight.
  monaco.editor.defineTheme('snakie-dark', {
    base: 'vs-dark',
    inherit: true,
    rules: DARK_PAPER_RULES,
    colors: {
      'editor.background': '#00000000',
      'editorGutter.background': '#00000000',
      // Lightened from #5a5f6e so inactive line numbers clear ≥3:1 on the dark
      // ruled-paper band (a11y, #188).
      'editorLineNumber.foreground': '#6e7488',
      'editorLineNumber.activeForeground': '#d6a23f',
      'minimap.background': '#1c1e24',
      'editorWidget.background': '#23262f',
      'editor.lineHighlightBackground': '#00000000',
      'editor.selectionBackground': '#3a4258',
      'editor.foreground': '#d4d8e0'
    }
  })
  monaco.editor.defineTheme('snakie-light', { base: 'vs', inherit: true, rules: [], colors: {} })
  // Skeuomorph editor colour themes (issue #84): Paper (warm cream), Bright
  // (whiter paper, vivid syntax) and Midnight (dark). Paper themes keep a
  // transparent surface so the CSS ruled-paper (`.lines-content` in index.css)
  // shows through; an opaque theme paints its own background and the ruled lines
  // are hidden by the matching `data-editor-theme` CSS branch.
  for (const def of EDITOR_THEME_LIST) {
    monaco.editor.defineTheme(monacoThemeName(def.id), {
      base: def.paper ? 'vs' : 'vs-dark',
      inherit: true,
      rules: def.rules,
      colors: {
        'editor.background': def.monaco.background,
        'editorGutter.background': def.monaco.gutterBackground,
        'editorLineNumber.foreground': def.monaco.lineNumber,
        'editorLineNumber.activeForeground': def.monaco.lineNumberActive,
        'minimap.background': def.monaco.minimap,
        'editorWidget.background': def.monaco.widget,
        'editor.lineHighlightBackground': def.monaco.lineHighlight,
        'editor.selectionBackground': def.monaco.selection,
        'editor.foreground': def.monaco.foreground
      }
    })
  }
}

/** Resolve the app skin + editor-theme id to the Monaco theme name. The
 * Skeuomorph skin (shown as "Light") uses the user-selected editor colour theme;
 * the Dark theme (issue #91) uses `snakie-dark`, the dark ruled-paper theme
 * (transparent surface so the CSS deep-slate paper shows through). */
export function monacoTheme(theme: string, editorTheme: string): string {
  if (theme === 'skeuomorph') return monacoThemeName(editorTheme)
  return 'snakie-dark'
}

/** Editor metrics per skin. Both Skeuomorph skins (light + the dark variant,
 * issue #91) sit the text on ruled-paper lines, so their line height tracks the
 * user's configured spacing (issues #80/#81) — which must equal the CSS gradient
 * period (`--editor-rule-spacing`) for the text to land on the lines. The plain
 * `light` skin keeps fixed metrics. */
export function editorMetricsFor(
  theme: string,
  lineSpacing: number
): { fontSize: number; lineHeight: number } {
  return theme === 'skeuomorph' || theme === 'dark'
    ? { fontSize: 14, lineHeight: lineSpacing }
    : { fontSize: 13, lineHeight: 20 }
}
