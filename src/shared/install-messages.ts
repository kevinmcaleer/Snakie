/**
 * WHAT A FAILED INSTALL SAYS (#776).
 * =============================================================================
 *
 * Installing a driver or package used to run `mip.install()` ON THE BOARD, and
 * that route asks the board for something most boards do not have: its own
 * internet connection. A Tiny 2350, a non-W Pico, any USB-only board can never
 * satisfy it — and `mip` itself is an optional micropython-lib package that
 * CircuitPython and many vendor builds omit, so it often wasn't even importable.
 * Users saw a bare `ImportError("no module named 'mip'")` and had no way to know
 * Snakie had picked a method their hardware could not run.
 *
 * The install is now always: **resolve the package on the computer** (which has
 * the internet connection) and **write the files to the board**. That gives an
 * install exactly two places to fail, and this module owns how each one reads:
 *
 *  - {@link resolveFailureMessage} — the download/resolution didn't finish.
 *  - {@link writeFailureMessage}   — the files were fine; the board rejected them.
 *
 * Both produce ONE line, because the banners that surface an install failure
 * render only the log's last line — a multi-line explanation would show the user
 * nothing but its tail.
 *
 * Dependency-free (only the resolver's failure-kind type), so main, preload,
 * renderer, the web build and the unit tests share one set of words.
 */
import type { MipFailureKind } from './mip-resolve'

/**
 * The fact that makes every one of these failures make sense, and the reason
 * the install works this way at all.
 */
const WHY_HOST =
  'Snakie downloads a package on your computer and copies the files to the board, ' +
  'because the board has no internet connection of its own'

/** The per-failure "what you can do" clause. Kept beside the kinds it maps. */
function advice(kind: MipFailureKind): string {
  switch (kind) {
    case 'network':
      return 'Check your internet connection (and any proxy or firewall) and try again.'
    case 'not-found':
      return (
        'That address does not exist, so the package has moved or been renamed upstream — ' +
        'please report it so the catalog can be corrected.'
      )
    case 'unsupported':
      return (
        'Install it by copying the files into the library folder yourself with the Files panel.'
      )
    case 'too-big':
      return (
        'Copy the files into the library folder yourself with the Files panel, or install ' +
        'a smaller package.'
      )
    case 'malformed':
    default:
      return (
        "Snakie couldn't read the package description; copy the files into the library " +
        'folder yourself with the Files panel.'
      )
  }
}

/**
 * The message shown when a package could not be RESOLVED — nothing was
 * downloaded, so nothing reached the board.
 *
 * It always names four things: what failed, how Snakie installs and why, what
 * it was trying to fetch and how that went wrong, and what to do. So it can
 * never degrade into the bare `ImportError` it replaced.
 */
export function resolveFailureMessage(options: {
  /** The driver or package's display name. */
  name: string
  /** The spec being resolved. */
  spec: string
  /** Why resolution failed. */
  kind: MipFailureKind
  /** The underlying detail (a URL and status, a timeout, …). */
  detail: string
}): string {
  const { name, spec, kind, detail } = options
  return (
    `Couldn't install ${name}: ${WHY_HOST} — but downloading ${spec} failed: ${detail}. ` +
    advice(kind)
  ).replace(/\s+/g, ' ')
}

/**
 * The message shown when the files downloaded fine and the BOARD refused them —
 * a full filesystem, a read-only CircuitPython drive, a disconnect mid-write.
 *
 * Kept separate from {@link resolveFailureMessage} so the two halves of an
 * install are never confused for each other: "we couldn't get it" and "your
 * board wouldn't take it" have completely different fixes. The device layer
 * already turns the errors worth explaining (`OSError 28`/`30`) into readable
 * text, so `detail` is passed through rather than re-interpreted here.
 */
export function writeFailureMessage(options: {
  /** The driver or package's display name. */
  name: string
  /** The on-device path being written when it failed, when known. */
  path?: string
  /** The device's own reason. */
  detail: string
}): string {
  const { name, path, detail } = options
  const what = path ? `writing ${path} to the board` : 'writing to the board'
  return (
    `Couldn't install ${name}: the files downloaded to your computer, but ${what} failed: ` +
    `${detail}.`
  ).replace(/\s+/g, ' ')
}

/**
 * The same two failures, worded for the ADAFRUIT BUNDLE route (#758).
 *
 * A CircuitPython install fails in the same two places and for the same
 * reasons, but the nouns differ enough to matter: there is no `mip` spec to
 * name, the source is a bundle rather than a repository, and — uniquely — an
 * install can fail because the BOARD'S CIRCUITPYTHON IS THE WRONG VERSION,
 * which "copy the files in yourself" is the wrong advice for. `.mpy` bytecode is
 * published per CircuitPython major, so the fix is to update the board.
 */
function bundleAdvice(kind: MipFailureKind): string {
  switch (kind) {
    case 'unsupported':
      return (
        'Update CircuitPython on the board to a version the bundle still ships, or copy the ' +
        'library into /lib yourself with the Files panel.'
      )
    case 'not-found':
      return (
        'That library is not in the bundle at the version it pins, so it has been renamed or ' +
        'withdrawn upstream — please report it so the catalog can be corrected.'
      )
    default:
      return advice(kind)
  }
}

/**
 * The message shown when a CircuitPython library could not be resolved out of
 * the Adafruit bundle. Names what failed, where CircuitPython libraries come
 * from, which library it stopped on, and what to do — so it can never degrade
 * into a bare HTTP status.
 */
export function bundleFailureMessage(options: {
  /** The driver's display name. */
  name: string
  /** The bundle library being resolved when it failed. */
  module: string
  /** Why resolution failed. */
  kind: MipFailureKind
  /** The underlying detail (a version mismatch, a URL and status, …). */
  detail: string
}): string {
  const { name, module, kind, detail } = options
  return (
    `Couldn't install ${name}: CircuitPython libraries come from the Adafruit CircuitPython ` +
    `Library Bundle, which Snakie downloads on your computer and copies into /lib — but ` +
    `${module} couldn't be resolved: ${detail}. ${bundleAdvice(kind)}`
  ).replace(/\s+/g, ' ')
}

/** What the user is told about where a BUNDLE install's files came from. */
export function bundleInstallNote(options: {
  /** Every bundle library installed, in install order — dependencies first, the
   *  library that was actually asked for LAST. */
  modules: readonly string[]
  /** The driver's display name. */
  name: string
  /** How many files were written. */
  fileCount: number
  /** The CircuitPython major the `.mpy` files were built for. */
  major: number
  /** The install directory (`/lib`). */
  target: string
}): string {
  const { name, modules, fileCount, major, target } = options
  const files = fileCount === 1 ? '1 file' : `${fileCount} files`
  // `modules` ends with the library that was asked for; everything before it
  // came along because the index said it was needed. Naming them matters — a
  // user who asked for one driver and got seven files deserves to know why.
  const dependencies = modules.slice(0, -1)
  const deps =
    dependencies.length > 0
      ? ` with ${dependencies.length === 1 ? 'its dependency' : 'its dependencies'} ${dependencies.join(', ')}`
      : ''
  return (
    `Downloaded ${name} from the Adafruit CircuitPython Library Bundle for CircuitPython ` +
    `${major}${deps} — ${files} into ${target}.`
  )
}

/** What the user is told about where an install's files came from and went. */
export function hostInstallNote(options: {
  /** The driver or package's display name. */
  name: string
  /** The spec that was resolved. */
  spec: string
  /** How many files were written. */
  fileCount: number
  /** The install directory (`/lib`). */
  target: string
}): string {
  const { name, spec, fileCount, target } = options
  const files = fileCount === 1 ? '1 file' : `${fileCount} files`
  return `Downloaded ${name} (${spec}) on your computer — ${files} into ${target}.`
}
