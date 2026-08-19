import { MIP_DEFAULT_TARGET } from '../../shared/mip-resolve'
import type { InstallOptions } from './types'

/**
 * Package-install planning (issue #20, reworked by #776).
 *
 * The install used to run MicroPython's `mip` ON THE DEVICE — this file built
 * the snippet and the renderer ran it over `device.exec`. That needed the
 * BOARD to have an internet connection, which most boards simply do not have:
 * a Tiny 2350 or a non-W Pico has no radio at all, and `mip` is an optional
 * micropython-lib package missing from CircuitPython and many vendor builds.
 *
 * So the direction is reversed. `packages:install` resolves the package HERE
 * (`resolveMipSpec`, on the machine that actually has the network) and hands
 * back files; the renderer writes them down the same `device.writeFile` path
 * every other install uses. What's left in this file is the part that was
 * always host-side reasoning: the install TARGET and the non-fatal notes.
 */

/** Where a package installs when the request doesn't say. */
export function installTarget(options: InstallOptions = {}): string {
  const target = options.target?.trim()
  return target && target.length > 0 ? target : MIP_DEFAULT_TARGET
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
      'Installing replaces files of the same name; there is no no-overwrite mode, ' +
        'so existing files may still be replaced.'
    )
  }
  if (options.index && options.index.trim()) {
    notes.push(`Using custom package index: ${options.index.trim()}`)
  }
  return notes
}
