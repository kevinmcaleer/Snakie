import type { InstallOptions } from './types'

/**
 * Install-snippet builder (issue #20).
 *
 * The actual install runs MicroPython's `mip` ON THE DEVICE. The device is only
 * reachable through the serial layer, which the renderer drives via
 * `window.api.device.exec`. So rather than reaching into the device from here,
 * the main process is responsible for the parts that need privilege / network
 * reasoning — composing a safe `mip` snippet and computing any non-fatal NOTES
 * (e.g. the `.mpy` caveat) — and hands the snippet back for the renderer to run
 * over the existing, serialized `device.exec` channel.
 *
 * The snippet prints sentinel markers so the renderer can tell success from a
 * device-side traceback even though `mip` writes progress to stdout.
 */

export const INSTALL_START = '<<SNAKIE_MIP_START>>'
export const INSTALL_OK = '<<SNAKIE_MIP_OK>>'
export const INSTALL_ERR = '<<SNAKIE_MIP_ERR>>'

/** Encode a JS string as a Python string literal (single-quoted, escaped). */
function pyStr(value: string): string {
  return "'" + value.replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'"
}

/**
 * Build the keyword-argument list for `mip.install(...)` from the user options.
 * `mip.install(name, target=None, index=None, version=None)` is the broadly
 * supported signature; `mpy=` is NOT a parameter, so the `.mpy` request is
 * handled as a note (see {@link installNotes}) rather than passed through.
 */
function buildKwargs(options: InstallOptions): string[] {
  const kwargs: string[] = []
  if (options.target && options.target.trim()) {
    kwargs.push(`target=${pyStr(options.target.trim())}`)
  }
  if (options.index && options.index.trim()) {
    kwargs.push(`index=${pyStr(options.index.trim())}`)
  }
  return kwargs
}

/**
 * Compose the Python snippet to run on the device for installing `name`.
 *
 * `mip.install` itself overwrites existing files by default, so the snippet
 * works for both the overwrite and non-overwrite cases; the distinction is
 * carried to the user as a note (see {@link installNotes}). The whole call is
 * wrapped in try/except so we always emit a definitive OK/ERR sentinel.
 */
export function buildInstallSnippet(name: string, options: InstallOptions = {}): string {
  const args = [pyStr(name), ...buildKwargs(options)].join(', ')
  return [
    `print(${pyStr(INSTALL_START)})`,
    'try:',
    '    import mip',
    `    mip.install(${args})`,
    `    print(${pyStr(INSTALL_OK)})`,
    'except Exception as __e:',
    `    print(${pyStr(INSTALL_ERR)}, repr(__e))`
  ].join('\n')
}

/**
 * Non-fatal notes for an install request. These never block the install; they
 * explain where an advanced option is best-effort or unavailable so the UI can
 * surface it gracefully (per the feedback in docs/feedback.md).
 */
export function installNotes(options: InstallOptions = {}): string[] {
  const notes: string[] = []
  if (options.mpy) {
    notes.push(
      '.mpy conversion is not available in this build (no bundled mpy-cross). ' +
        'Packages are installed as source .py; many ports compile to bytecode on import.'
    )
  }
  if (options.overwrite === false) {
    notes.push(
      "mip.install replaces existing files by default; this firmware doesn't expose a " +
        'no-overwrite mode, so existing files may still be replaced.'
    )
  }
  if (options.index && options.index.trim()) {
    notes.push(`Using custom package index: ${options.index.trim()}`)
  }
  return notes
}
