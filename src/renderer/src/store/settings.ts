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

/** How the notebook paper is drawn behind the editor. */
export type EditorPaper = 'lines' | 'dots' | 'off'

export const MIN_LINE_SPACING = 22
export const MAX_LINE_SPACING = 48
export const DEFAULT_LINE_SPACING = 30

export interface SettingsStore {
  /** Ruled lines, squared dots, or nothing behind the editor. */
  paper: EditorPaper
  /** Px between ruled lines; also the editor line height (kept in sync). */
  lineSpacing: number
  setPaper: (paper: EditorPaper) => void
  /** Set the line spacing (clamped to [MIN, MAX]). */
  setLineSpacing: (px: number) => void
}

const SettingsContext = createContext<SettingsStore | null>(null)

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

  // Apply the paper mode + spacing to the document root so the CSS ruled paper
  // and Monaco's line height both follow the same source of truth.
  useEffect(() => {
    document.documentElement.setAttribute('data-editor-paper', paper)
  }, [paper])

  useEffect(() => {
    document.documentElement.style.setProperty('--editor-rule-spacing', `${lineSpacing}px`)
  }, [lineSpacing])

  const store = useMemo<SettingsStore>(
    () => ({
      paper,
      lineSpacing,
      setPaper,
      setLineSpacing: (px: number) => setLineSpacingRaw(clampSpacing(px))
    }),
    [paper, lineSpacing, setPaper, setLineSpacingRaw]
  )

  return createElement(SettingsContext.Provider, { value: store }, children)
}

/** Access the editor settings store. Must be used within <SettingsProvider>. */
export function useEditorSettings(): SettingsStore {
  const ctx = useContext(SettingsContext)
  if (!ctx) throw new Error('useEditorSettings must be used within a SettingsProvider')
  return ctx
}
