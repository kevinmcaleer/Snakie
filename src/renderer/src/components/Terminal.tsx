import { useEffect, useRef } from 'react'
import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'

/**
 * Dark terminal theme used by the REPL. ANSI colours are kept vivid so device
 * output (tracebacks, prompts, coloured logging) reads clearly — the reviewer
 * specifically valued console colour highlighting.
 */
const TERMINAL_THEME = {
  background: '#101216',
  foreground: '#e6e8eb',
  cursor: '#3b82f6',
  cursorAccent: '#101216',
  selectionBackground: '#3b82f655',
  black: '#16181d',
  red: '#ef4444',
  green: '#22c55e',
  yellow: '#eab308',
  blue: '#3b82f6',
  magenta: '#a855f7',
  cyan: '#06b6d4',
  white: '#e6e8eb',
  brightBlack: '#6b7280',
  brightRed: '#f87171',
  brightGreen: '#4ade80',
  brightYellow: '#facc15',
  brightBlue: '#60a5fa',
  brightMagenta: '#c084fc',
  brightCyan: '#22d3ee',
  brightWhite: '#ffffff'
}

const decoder = new TextDecoder()

/**
 * Interactive xterm.js REPL bound to the MicroPython device stream.
 *
 *  - incoming serial bytes (`device.onData`) are decoded and written to the term
 *  - user keystrokes (`term.onData`) are forwarded raw via `device.sendData`,
 *    so control bytes like Ctrl-C (`\x03`) and Ctrl-D (`\x04`) pass straight
 *    through to the friendly REPL
 *
 * The terminal is created once and resized to its container via the fit addon.
 */
export function Terminal(): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return undefined

    const term = new XTerm({
      cursorBlink: true,
      convertEol: true,
      fontFamily:
        'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
      fontSize: 13,
      scrollback: 5000,
      theme: TERMINAL_THEME,
      allowProposedApi: true
    })
    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)
    term.open(container)
    fitAddon.fit()

    // Device -> terminal.
    const unsubscribeData = window.api.device.onData((chunk) => {
      term.write(decoder.decode(chunk, { stream: true }))
    })

    // Terminal -> device. Forward raw bytes (control chars included).
    const inputDisposable = term.onData((data) => {
      window.api.device.sendData(data).catch(() => undefined)
    })

    // Keep the terminal sized to its panel as it resizes.
    const resizeObserver = new ResizeObserver(() => {
      try {
        fitAddon.fit()
      } catch {
        // fit() can throw if the element is momentarily detached; ignore.
      }
    })
    resizeObserver.observe(container)

    return () => {
      unsubscribeData()
      inputDisposable.dispose()
      resizeObserver.disconnect()
      term.dispose()
    }
  }, [])

  return <div className="terminal" ref={containerRef} />
}
