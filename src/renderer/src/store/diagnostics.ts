/**
 * Diagnostics store — the shared seam between the editor (which produces
 * diagnostics by linting the active file) and the Problems panel (which lists
 * them) for issue #65.
 *
 * The editor used to hold the active file's diagnostics internally. Lifting
 * them here lets the Problems panel render the same data the squiggles are drawn
 * from, without either component referencing the other.
 *
 * SHAPE (consumers depend on this):
 *
 *   interface DiagnosticsStore {
 *     diagnostics: Diagnostic[]          // active file's latest diagnostics
 *     linterTool: string | null         // 'ruff' | 'pyflakes' | 'none' | null(unknown)
 *     setDiagnostics(diagnostics): void  // editor publishes after each lint
 *     setLinterTool(tool): void          // editor publishes detected tool
 *     clear(): void                      // wipe (e.g. linting turned off)
 *   }
 *
 * Implemented as a React context + state (no external dep). Consume via
 * `useDiagnostics()`; wrap the app in <DiagnosticsProvider> (alongside the
 * workspace provider). It is intentionally "single active file" — the editor
 * shows one file at a time, and the panel mirrors that.
 */
import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode
} from 'react'
import type { Diagnostic } from '../../../preload/index.d'

export interface DiagnosticsStore {
  /** The active file's latest diagnostics (empty when clean or not linted). */
  diagnostics: Diagnostic[]
  /**
   * The linter tool the host detected: `'ruff'`, `'pyflakes'`, `'none'`, or
   * `null` when not yet probed. `'none'` drives the "install ruff" hint.
   */
  linterTool: string | null
  /** Replace the published diagnostics (editor calls this after each lint). */
  setDiagnostics: (diagnostics: Diagnostic[]) => void
  /** Record which linter tool was detected. */
  setLinterTool: (tool: string | null) => void
  /** Clear diagnostics (e.g. when linting is turned off or no file is open). */
  clear: () => void
}

const DiagnosticsContext = createContext<DiagnosticsStore | null>(null)

/** Provides the diagnostics store. Wrap the app once near the root. */
export function DiagnosticsProvider({ children }: { children: ReactNode }): JSX.Element {
  const [diagnostics, setDiagnosticsState] = useState<Diagnostic[]>([])
  const [linterTool, setLinterToolState] = useState<string | null>(null)

  const setDiagnostics = useCallback((next: Diagnostic[]): void => {
    setDiagnosticsState(next)
  }, [])

  const setLinterTool = useCallback((tool: string | null): void => {
    setLinterToolState(tool)
  }, [])

  const clear = useCallback((): void => {
    setDiagnosticsState([])
  }, [])

  const store = useMemo<DiagnosticsStore>(
    () => ({ diagnostics, linterTool, setDiagnostics, setLinterTool, clear }),
    [diagnostics, linterTool, setDiagnostics, setLinterTool, clear]
  )

  return createElement(DiagnosticsContext.Provider, { value: store }, children)
}

/** Access the diagnostics store. Must be used within <DiagnosticsProvider>. */
export function useDiagnostics(): DiagnosticsStore {
  const ctx = useContext(DiagnosticsContext)
  if (!ctx) throw new Error('useDiagnostics must be used within a DiagnosticsProvider')
  return ctx
}
