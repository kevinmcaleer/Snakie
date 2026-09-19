/**
 * Editor settings store (issues #80, #81).
 *
 * Holds the user's notebook-paper preferences for the cream ruled-paper editor:
 *  - `paper`        — show ruled `lines`, subtle squared `dots`, or `off`.
 *  - `lineSpacing`  — px between ruled lines (also the editor line height).
 *
 * Both are persisted via {@link useLocalStorage} so they survive restarts, and
 * applied to `document.documentElement` so the single source of truth drives
 * BOTH the CSS ruled paper (`--editor-rule-spacing` + `data-editor-paper` in
 * index.css) and Monaco's line height (MonacoEditor reads `lineSpacing`). Those
 * two MUST stay equal or the text stops sitting on the lines.
 *
 * Implemented as a React context + state (no external dep), mirroring the
 * diagnostics store. Consume via `useEditorSettings()`; wrap the app in
 * <SettingsProvider>.
 */
import {
  createContext,
  createElement,
  useContext,
  useEffect,
  useMemo,
  type ReactNode
} from 'react'
import { useLocalStorage } from '../hooks/useLocalStorage'
import { DEFAULT_EDITOR_THEME, editorThemeFor } from './editorThemes'
import type { DialectPreference } from '../../../shared/dialect-api'
import { DEFAULT_BLOCK_SHAPE, type BlockShape } from '../lib/blocks/theme'

export type { BlockShape }

/** How the notebook paper is drawn behind the editor. */
export type EditorPaper = 'lines' | 'dots' | 'off'

/** The Board View breadboard/canvas background: the default dark mat, or a
 *  classic blueprint (blue paper + light grid). */
export type BreadboardBg = 'dark' | 'blueprint' | 'white'

export const MIN_LINE_SPACING = 22
export const MAX_LINE_SPACING = 48
export const DEFAULT_LINE_SPACING = 30

export interface SettingsStore {
  /** Ruled lines, squared dots, or nothing behind the editor. */
  paper: EditorPaper
  /** Px between ruled lines; also the editor line height (kept in sync). */
  lineSpacing: number
  /** Selected editor colour theme id (see store/editorThemes). */
  editorTheme: string
  /** Whether to check for a newer MicroPython firmware for the device (#173). */
  checkFirmwareUpdates: boolean
  /** Whether the editor shows Monaco's mini-map (#210). Default on. */
  minimap: boolean
  /** The Board View breadboard background. Default `dark`. */
  breadboardBg: BreadboardBg
  /** Whether the status bar shows rotating 💡 discovery tips (#434). Default on. */
  showTips: boolean
  /**
   * Which of Blockly's three geometries the block canvas wears.
   *
   * `standard` (the default), `classic` or `scratch` — see `BlockShape` in
   * `lib/blocks/theme.ts` for what each one is. A shape change re-injects the
   * canvas, because Blockly fixes its renderer when the workspace is created.
   */
  blockShape: BlockShape
  /**
   * Which Python the help pages and editor completions should teach (#763).
   * `'auto'` (the default) follows the connected board; the explicit values are
   * the override for reading before anything is plugged in.
   */
  helpDialect: DialectPreference
  setPaper: (paper: EditorPaper) => void
  /** Set the line spacing (clamped to [MIN, MAX]). */
  setLineSpacing: (px: number) => void
  /** Set the editor colour theme by id. */
  setEditorTheme: (id: string) => void
  /** Enable/disable the newer-firmware check (#173). */
  setCheckFirmwareUpdates: (on: boolean) => void
  /** Show/hide the editor mini-map (#210). */
  setMinimap: (on: boolean) => void
  /** Set the Board View breadboard background. */
  setBreadboardBg: (bg: BreadboardBg) => void
  /** Show/hide the status-bar discovery tips (#434). */
  setShowTips: (on: boolean) => void
  /** Follow the board, or pin the help/completions to one runtime (#763). */
  setHelpDialect: (pref: DialectPreference) => void
  /** Set the shape the block canvas draws its blocks in. */
  setBlockShape: (shape: BlockShape) => void
}

const SettingsContext = createContext<SettingsStore | null>(null)

/** Where the chosen block shape is persisted. */
export const BLOCK_SHAPE_KEY = 'snakie.blocks.shape'

/**
 * The chosen block shape, read straight out of storage.
 *
 * For the callers that are not React and cannot hold the context — the PDF
 * export injects a workspace of its own (`lib/pdf/blocks-source.ts`), and a
 * printed page that did not match the canvas it was printed from would be a
 * bug people would reasonably report. Falls back to the default for a value
 * this build does not recognise, which is what an older or newer setting looks
 * like.
 */
export function storedBlockShape(): BlockShape {
  try {
    const raw = window.localStorage.getItem(BLOCK_SHAPE_KEY)
    const shape = raw === null ? null : (JSON.parse(raw) as BlockShape)
    return shape === 'standard' || shape === 'classic' || shape === 'scratch'
      ? shape
      : DEFAULT_BLOCK_SHAPE
  } catch {
    return DEFAULT_BLOCK_SHAPE
  }
}

/** Clamp a spacing value to the supported range, rounding to whole px. */
export function clampSpacing(px: number): number {
  if (!Number.isFinite(px)) return DEFAULT_LINE_SPACING
  return Math.min(MAX_LINE_SPACING, Math.max(MIN_LINE_SPACING, Math.round(px)))
}

/** Provides the editor settings store. Wrap the app once near the root. */
export function SettingsProvider({ children }: { children: ReactNode }): JSX.Element {
  const [paper, setPaper] = useLocalStorage<EditorPaper>('snakie.editor.paper', 'lines')
  const [lineSpacing, setLineSpacingRaw] = useLocalStorage<number>(
    'snakie.editor.lineSpacing',
    DEFAULT_LINE_SPACING
  )
  const [editorTheme, setEditorTheme] = useLocalStorage<string>(
    'snakie.editor.theme',
    DEFAULT_EDITOR_THEME
  )
  const [checkFirmwareUpdates, setCheckFirmwareUpdates] = useLocalStorage<boolean>(
    'snakie.firmware.checkUpdates',
    true
  )
  const [minimap, setMinimap] = useLocalStorage<boolean>('snakie.editor.minimap', true)
  const [breadboardBg, setBreadboardBg] = useLocalStorage<BreadboardBg>(
    'snakie.board.breadboardBg',
    'blueprint'
  )
  const [showTips, setShowTips] = useLocalStorage<boolean>('snakie.statusbar.tips', true)
  const [helpDialect, setHelpDialect] = useLocalStorage<DialectPreference>(
    'snakie.help.dialect',
    'auto'
  )
  const [blockShape, setBlockShape] = useLocalStorage<BlockShape>(
    BLOCK_SHAPE_KEY,
    DEFAULT_BLOCK_SHAPE
  )

  // Apply the paper mode + spacing to the document root so the CSS ruled paper
  // and Monaco's line height both follow the same source of truth.
  useEffect(() => {
    document.documentElement.setAttribute('data-editor-paper', paper)
  }, [paper])

  useEffect(() => {
    document.documentElement.style.setProperty('--editor-rule-spacing', `${lineSpacing}px`)
  }, [lineSpacing])

  // Apply the editor colour theme (issue #84): set a data attribute (so CSS can
  // branch per theme, e.g. hiding ruled lines for an opaque dark theme) and
  // publish the theme's paper-band / rule / region / dot colours as CSS custom
  // properties that index.css reads — keeping the CSS ruled paper and the Monaco
  // theme (registered + selected in MonacoEditor) in lockstep from one source.
  //
  // The editor COLOUR themes are a Skeuomorph(-light)-skin feature: the Dark
  // Skeuomorph skin (issue #91) renders its own cohesive deep-slate ruled paper
  // from the `:root[data-theme='dark']` token defaults in index.css. So under
  // the dark skin we must NOT push the (light/cream) editor-theme paper vars as
  // inline styles (they'd win over the stylesheet and repaint the dark paper
  // cream), and we clear `data-editor-theme` so the `…='midnight'` line-hiding
  // branch never fires. We re-run on `data-theme` changes so toggling the skin
  // re-applies correctly. The plain `light` skin keeps the cream paper vars.
  useEffect(() => {
    const root = document.documentElement
    const apply = (): void => {
      if (root.getAttribute('data-theme') === 'dark') {
        root.removeAttribute('data-editor-theme')
        root.style.removeProperty('--editor-paper-band')
        root.style.removeProperty('--editor-paper-rule')
        root.style.removeProperty('--editor-paper-dot')
        root.style.removeProperty('--editor-region-bg')
        root.style.removeProperty('--editor-margin-rule')
        return
      }
      const def = editorThemeFor(editorTheme)
      root.setAttribute('data-editor-theme', def.id)
      root.style.setProperty('--editor-paper-band', def.paperBand)
      root.style.setProperty('--editor-paper-rule', def.paperRule)
      root.style.setProperty('--editor-paper-dot', def.dotColor)
      root.style.setProperty('--editor-region-bg', def.regionBg)
      root.style.setProperty('--editor-margin-rule', def.marginRule)
    }
    apply()
    const observer = new MutationObserver(apply)
    observer.observe(root, { attributes: true, attributeFilter: ['data-theme'] })
    return () => observer.disconnect()
  }, [editorTheme])

  const store = useMemo<SettingsStore>(
    () => ({
      paper,
      lineSpacing,
      editorTheme,
      checkFirmwareUpdates,
      minimap,
      breadboardBg,
      showTips,
      helpDialect,
      blockShape,
      setPaper,
      setLineSpacing: (px: number) => setLineSpacingRaw(clampSpacing(px)),
      setEditorTheme,
      setCheckFirmwareUpdates,
      setMinimap,
      setBreadboardBg,
      setShowTips,
      setHelpDialect,
      setBlockShape
    }),
    [
      paper,
      lineSpacing,
      editorTheme,
      checkFirmwareUpdates,
      minimap,
      breadboardBg,
      showTips,
      helpDialect,
      blockShape,
      setPaper,
      setLineSpacingRaw,
      setEditorTheme,
      setCheckFirmwareUpdates,
      setMinimap,
      setBreadboardBg,
      setShowTips,
      setHelpDialect,
      setBlockShape
    ]
  )

  return createElement(SettingsContext.Provider, { value: store }, children)
}

/** Access the editor settings store. Must be used within <SettingsProvider>. */
export function useEditorSettings(): SettingsStore {
  const ctx = useContext(SettingsContext)
  if (!ctx) throw new Error('useEditorSettings must be used within a SettingsProvider')
  return ctx
}
