import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { terminalThemeFor } from '../components/Terminal'

/**
 * THE EMBED'S REPL (#1286).
 * =============================================================================
 *
 * The app's console look (the same xterm, the same phosphor palette), bound to
 * an embed engine instead of `window.api.device`. Two input modes:
 *
 *  - **raw** (MicroPython): every key goes straight to the friendly REPL, which
 *    does its own echo, history and line editing, exactly as on a board.
 *  - **line** (Pyodide): CPython in a worker has no terminal of its own, so a
 *    line is edited here (echo, Backspace, paste) and sent whole on Enter.
 *    Ctrl-C asks the parent to stop.
 */
export interface EmbedTerminalHandle {
  write: (text: string) => void
  clear: () => void
  focus: () => void
}

export interface EmbedTerminalProps {
  lineMode: boolean
  /** Keys (raw mode) or a finished line (line mode). */
  onInput: (data: string) => void
  /** Ctrl-C in line mode. */
  onInterrupt?: () => void
}

export const EmbedTerminal = forwardRef<EmbedTerminalHandle, EmbedTerminalProps>(function EmbedTerminal(
  { lineMode, onInput, onInterrupt },
  ref
): JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<XTerm | null>(null)
  const onInputRef = useRef(onInput)
  onInputRef.current = onInput
  const onInterruptRef = useRef(onInterrupt)
  onInterruptRef.current = onInterrupt
  const lineModeRef = useRef(lineMode)
  lineModeRef.current = lineMode

  useImperativeHandle(
    ref,
    () => ({
      write: (text) => termRef.current?.write(text),
      clear: () => termRef.current?.clear(),
      focus: () => termRef.current?.focus()
    }),
    []
  )

  useEffect(() => {
    const host = hostRef.current
    if (!host) return undefined
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
    const term = new XTerm({
      cursorBlink: !reduced,
      convertEol: true,
      fontFamily: "'IBM Plex Mono', 'DejaVu Sans Mono', ui-monospace, monospace",
      fontSize: 13,
      scrollback: 2000,
      theme: terminalThemeFor(document.documentElement.getAttribute('data-theme')),
      screenReaderMode: true
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(host)
    try {
      fit.fit()
    } catch {
      /* detached for a moment */
    }
    termRef.current = term

    let line = ''
    const keys = term.onData((data) => {
      if (!lineModeRef.current) {
        onInputRef.current(data)
        return
      }
      for (const ch of data.replace(/\r\n/g, '\r').replace(/\n/g, '\r')) {
        if (ch === '\r') {
          term.write('\r\n')
          const sent = line
          line = ''
          onInputRef.current(sent)
        } else if (ch === '\x7f' || ch === '\b') {
          if (line.length > 0) {
            line = line.slice(0, -1)
            term.write('\b \b')
          }
        } else if (ch === '\x03') {
          line = ''
          term.write('^C\r\n')
          onInterruptRef.current?.()
        } else if (ch >= ' ' || ch === '\t') {
          const shown = ch === '\t' ? '    ' : ch
          line += shown
          term.write(shown)
        }
      }
    })

    const resize = new ResizeObserver(() => {
      try {
        fit.fit()
      } catch {
        /* ignore */
      }
    })
    resize.observe(host)
    const themeObserver = new MutationObserver(() => {
      term.options.theme = terminalThemeFor(document.documentElement.getAttribute('data-theme'))
    })
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })

    return () => {
      keys.dispose()
      resize.disconnect()
      themeObserver.disconnect()
      term.dispose()
      termRef.current = null
    }
  }, [])

  return <div className="snk-embed__terminal terminal" ref={hostRef} />
})

export default EmbedTerminal
