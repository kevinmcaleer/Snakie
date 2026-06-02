import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'

/**
 * Imperative handle exposed by {@link Terminal}, letting parents drive the
 * underlying xterm instance without owning it. Currently this is just `clear`,
 * used by the ShellPanel "Clear" (trashcan) control.
 */
export interface TerminalHandle {
  clear: () => void
}

/**
 * Dark terminal theme used by the REPL. ANSI colours are kept vivid so device
 * output (tracebacks, prompts, coloured logging) reads clearly — the reviewer
 * specifically valued console colour highlighting.
 */
const TERMINAL_THEME = {
  background: '#14141f',
  foreground: '#e8e8f0',
  cursor: '#3cbcfc',
  cursorAccent: '#14141f',
  selectionBackground: '#3cbcfc55',
  black: '#1f1f30',
  red: '#e60012',
  green: '#00b800',
  yellow: '#f8d800',
  blue: '#3cbcfc',
  magenta: '#b800e6',
  cyan: '#00b8b8',
  white: '#e8e8f0',
  brightBlack: '#9a9ab8',
  brightRed: '#f83800',
  brightGreen: '#58f898',
  brightYellow: '#f8f858',
  brightBlue: '#6cbcfc',
  brightMagenta: '#f878f8',
  brightCyan: '#58f8f8',
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
export const Terminal = forwardRef<TerminalHandle>(function Terminal(_props, ref): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<XTerm | null>(null)

  // Expose an imperative `clear` so the ShellPanel header trashcan can wipe the
  // scrollback without lifting ownership of the xterm instance out of here.
  useImperativeHandle(
    ref,
    () => ({
      clear: () => {
        termRef.current?.clear()
      }
    }),
    []
  )

  useEffect(() => {
    const container = containerRef.current
    if (!container) return undefined

    const term = new XTerm({
      cursorBlink: true,
      convertEol: true,
      fontFamily: "'Press Start 2P', monospace",
      fontSize: 12,
      scrollback: 5000,
      theme: TERMINAL_THEME,
      allowProposedApi: true
    })
    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)
    term.open(container)
    fitAddon.fit()
    termRef.current = term

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
      termRef.current = null
    }
  }, [])

  return <div className="terminal" ref={containerRef} />
})
