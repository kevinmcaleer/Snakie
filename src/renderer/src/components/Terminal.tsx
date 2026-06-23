import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { makeTelemetryFilter } from './terminal-telemetry'

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
const DARK_TERMINAL_THEME = {
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

/**
 * Skeuomorph skin (light + the dark variant, issue #91): a recessed dark-glass
 * screen glowing green phosphor, matching concept 08 of the MicroPython IDE
 * Concepts design. The near-black background pairs with the inset frame applied
 * to `.terminal` in index.css — which both skins now paint as a recessed
 * dark-glass console, so they share this phosphor palette.
 */
const SKEUO_TERMINAL_THEME = {
  background: '#080a07',
  foreground: '#5dff8a',
  cursor: '#8affa8',
  cursorAccent: '#080a07',
  selectionBackground: '#2bbf6a55',
  black: '#0b0d0a',
  red: '#ff7a5a',
  green: '#5dff8a',
  yellow: '#e8d36b',
  blue: '#7fd0ff',
  magenta: '#c9a0ff',
  cyan: '#7fe9d8',
  white: '#d6e6da',
  brightBlack: '#3f7a52',
  brightRed: '#ff9a7a',
  brightGreen: '#8affa8',
  brightYellow: '#f0e08a',
  brightBlue: '#a0e0ff',
  brightMagenta: '#e0b8ff',
  brightCyan: '#a8f0e0',
  brightWhite: '#eafff0'
}

/** Pick the terminal palette for the app's current `data-theme`. Both Skeuomorph
 * skins — the light default and its dark variant (issue #91) — frame the console
 * as a recessed dark-glass screen, so both glow green phosphor; the plain `light`
 * skin keeps the dark REPL palette. */
function terminalThemeFor(docTheme: string | null): typeof DARK_TERMINAL_THEME {
  return docTheme === 'skeuomorph' || docTheme === 'dark'
    ? SKEUO_TERMINAL_THEME
    : DARK_TERMINAL_THEME
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
      fontFamily: "'JetBrains Mono', 'DejaVu Sans Mono', ui-monospace, monospace",
      fontSize: 13,
      scrollback: 5000,
      theme: terminalThemeFor(document.documentElement.getAttribute('data-theme')),
      allowProposedApi: true
    })
    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)
    term.open(container)
    fitAddon.fit()
    termRef.current = term

    // Follow app theme changes (the document root's data-theme is the single
    // source of truth, set by useTheme) so the console repaints in step with
    // the rest of the UI — e.g. the Skeuomorph green-phosphor palette.
    const themeObserver = new MutationObserver(() => {
      term.options.theme = terminalThemeFor(document.documentElement.getAttribute('data-theme'))
    })
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme']
    })

    // Device -> terminal. Instruments telemetry lines (`SNK …`, issue #107) are
    // machine data for the scope/meter/plotter, so we filter them out of the
    // console here — the filter is streaming (a telemetry line can be split
    // across chunks) and only ever drops WHOLE telemetry lines, so normal device
    // output (tracebacks, prompts, plain prints) is untouched.
    const telemetryFilter = makeTelemetryFilter()
    const unsubscribeData = window.api.device.onData((chunk) => {
      const visible = telemetryFilter.push(decoder.decode(chunk, { stream: true }))
      if (visible) term.write(visible)
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
      themeObserver.disconnect()
      term.dispose()
      termRef.current = null
    }
  }, [])

  return <div className="terminal" ref={containerRef} />
})
