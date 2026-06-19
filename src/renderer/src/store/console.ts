/**
 * Console store (issue #78).
 *
 * No renderer-side console buffer existed before this — device output lived only
 * inside the xterm instance (`ShellPanel`/`Terminal`), which can't be read back.
 * This store subscribes ONCE to `window.api.device.onData`, decodes the bytes,
 * and keeps a bounded line buffer so the chat can attach recent REPL output as
 * context.
 *
 * It also records a "Run marker": the buffer position when the user pressed Run.
 * `getSinceRun()` returns everything printed after that marker, so "send console
 * to chat" delivers just the current program's output rather than all scrollback.
 *
 * Implemented as a React context (matching `store/diagnostics.ts`). Consume via
 * `useConsole()`; wrap the app in <ConsoleProvider> near the root.
 */
import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ReactNode
} from 'react'

/** Hard cap on retained lines, to bound memory on chatty programs. */
const MAX_LINES = 500

export interface ConsoleStore {
  /** Snapshot of all retained console lines (oldest first), joined with `\n`. */
  getAll: () => string
  /** Console output printed since the last {@link ConsoleStore.markRun} call. */
  getSinceRun: () => string
  /** Record the current buffer position as the start of a Run (called on Run). */
  markRun: () => void
}

const ConsoleContext = createContext<ConsoleStore | null>(null)

/** Provides the console store. Wrap the app once near the root. */
export function ConsoleProvider({ children }: { children: ReactNode }): JSX.Element {
  // A bounded ring of decoded lines. We keep the partial last line separate so
  // a chunk that splits mid-line is reassembled correctly across `onData` calls.
  const linesRef = useRef<string[]>([])
  const partialRef = useRef('')
  // Total lines ever appended (monotonic). The Run marker is one of these
  // indices, letting getSinceRun() slice even after old lines are evicted.
  const totalRef = useRef(0)
  const runMarkRef = useRef(0)

  useEffect(() => {
    const decoder = new TextDecoder()

    const append = (text: string): void => {
      // Normalise CR/LF so terminal control sequences don't fragment lines.
      const combined = partialRef.current + text
      const segments = combined.split(/\r\n|\r|\n/)
      // The final segment is an incomplete line until the next newline arrives.
      partialRef.current = segments.pop() ?? ''
      for (const seg of segments) {
        linesRef.current.push(seg)
        totalRef.current += 1
      }
      // Evict oldest lines beyond the cap.
      if (linesRef.current.length > MAX_LINES) {
        linesRef.current.splice(0, linesRef.current.length - MAX_LINES)
      }
    }

    const unsub = window.api.device.onData((chunk) => {
      append(decoder.decode(chunk, { stream: true }))
    })
    return unsub
  }, [])

  /** The absolute index of the first retained line (lines evicted before it). */
  const firstRetainedIndex = useCallback(
    (): number => totalRef.current - linesRef.current.length,
    []
  )

  const getAll = useCallback((): string => {
    const lines = [...linesRef.current]
    if (partialRef.current) lines.push(partialRef.current)
    return lines.join('\n')
  }, [])

  const getSinceRun = useCallback((): string => {
    const start = Math.max(runMarkRef.current, firstRetainedIndex())
    const offset = start - firstRetainedIndex()
    const lines = linesRef.current.slice(Math.max(0, offset))
    const out = [...lines]
    if (partialRef.current) out.push(partialRef.current)
    return out.join('\n').trim()
  }, [firstRetainedIndex])

  const markRun = useCallback((): void => {
    // Mark just past the current end so getSinceRun returns only new output.
    runMarkRef.current = totalRef.current
  }, [])

  const store = useMemo<ConsoleStore>(
    () => ({ getAll, getSinceRun, markRun }),
    [getAll, getSinceRun, markRun]
  )

  return createElement(ConsoleContext.Provider, { value: store }, children)
}

/** Access the console store. Must be used within <ConsoleProvider>. */
export function useConsole(): ConsoleStore {
  const ctx = useContext(ConsoleContext)
  if (!ctx) throw new Error('useConsole must be used within a ConsoleProvider')
  return ctx
}
