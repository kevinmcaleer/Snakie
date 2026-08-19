/**
 * DRIVER-INSTALL STRATEGY (#776) — capability, not dialect.
 * =============================================================================
 *
 * A catalog module with a `mip` source used to install exactly one way: run
 * `mip.install(<spec>)` on the board. `mip` is optional firmware furniture —
 * absent on CircuitPython (#769) and equally absent on vendor / feature-branch
 * MicroPython builds (#776) — so that route is a coin flip, and when it lost
 * the user got `ImportError("no module named 'mip'")` and nothing else.
 *
 * Two rules come out of that, and both live here so they are decided once and
 * tested without a board:
 *
 *  1. **Route on the CAPABILITY, not the dialect.** The board is asked whether
 *     it can `import mip` (see `RUNTIME_PROBE_PY`), and the answer — not
 *     "is this MicroPython?" — picks the mechanism. Routing by dialect would
 *     not have helped the Tiny 2350 in #776, which reports `micropython` and
 *     still has no `mip`.
 *  2. **Never surface a bare board error for it.** When the host route can't
 *     finish either, the message says what Snakie tried, why the board couldn't
 *     do it itself, and what the user can do — as ONE line, because the banners
 *     that show install failures render the log's last line.
 *
 * Dependency-free (only the shared dialect types), so main, preload, renderer,
 * the web build and the unit tests all share one set of rules.
 */
import { runtimeLabel, type RuntimeInfo } from './dialect'
import type { MipFailureKind } from './mip-resolve'

/**
 * What the connected board can do, as far as installing is concerned. Every
 * field is OPTIONAL and `undefined` means "not known" — never "no". The runtime
 * probe answers a moment AFTER connect, and a board that wouldn't answer at all
 * must not be treated as incapable (see {@link chooseMipRoute}).
 */
export interface InstallCapabilities {
  /** Can the board `import mip`? `undefined` until/unless the probe answered. */
  hasMip?: boolean
}

/** Read the install capabilities off a probed runtime (safe with null). */
export function capabilitiesFrom(runtime?: RuntimeInfo | null): InstallCapabilities {
  return runtime && runtime.hasMip !== undefined ? { hasMip: runtime.hasMip } : {}
}

/**
 * Which mechanism a `mip`-sourced module should install by.
 *
 * `'host'` ONLY when the board has definitively said it cannot import `mip`.
 * Unknown keeps the on-board route: it is the cheaper one (the board fetches
 * straight to its own filesystem, no host bandwidth, no path guessing), and
 * when it fails for a missing `mip` the caller can still fall back — see
 * {@link looksLikeMissingMip}. Being wrong in this direction costs a retry;
 * being wrong the other way would take the host route on every board.
 */
export function chooseMipRoute(caps: InstallCapabilities = {}): 'mip' | 'host' {
  return caps.hasMip === false ? 'host' : 'mip'
}

/**
 * Did this device output fail because the board has no `mip`?
 *
 * The safety net for the case the probe couldn't cover: a board whose runtime
 * probe never answered still gets the on-board route first, and this is what
 * turns its failure into a host-route retry instead of a dead end. Matches the
 * error BOTH runtimes raise — MicroPython's `ImportError: no module named
 * 'mip'` and CPython-style `ModuleNotFoundError: No module named 'mip'`.
 */
export function looksLikeMissingMip(log: string): boolean {
  if (!log) return false
  return /(?:Import|ModuleNotFound)Error[^\n]*\bno module named\s*['"`]?mip\b/i.test(log)
}

/** How the on-device `mip` is described, once, everywhere. */
const MIP_IS = "mip, MicroPython's on-board package installer"

/** Why a board might not have it — the fact that makes the failure make sense. */
const MIP_IS_OPTIONAL =
  'it is an optional package, so CircuitPython and many vendor firmware builds ship without it'

/** What the user is told when the host route SUCCEEDED in place of `mip`. */
export function hostInstallNote(options: {
  /** The driver's display name. */
  moduleName: string
  /** The `mip` spec that was resolved. */
  spec: string
  /** How many files were written. */
  fileCount: number
  /** The install directory (`/lib`). */
  target: string
}): string {
  const { moduleName, spec, fileCount, target } = options
  const files = fileCount === 1 ? '1 file' : `${fileCount} files`
  return (
    `This board has no ${MIP_IS}, so Snakie downloaded ${moduleName} (${spec}) ` +
    `on your computer and wrote ${files} to ${target}.`
  )
}

/** The per-failure "what you can do" clause. Kept beside the kinds it maps. */
function advice(kind: MipFailureKind): string {
  switch (kind) {
    case 'network':
      return 'Check your internet connection (and any proxy or firewall) and try again.'
    case 'not-found':
      return (
        'That address no longer exists, so the driver has moved or been renamed upstream — ' +
        'please report it so the catalog can be corrected.'
      )
    case 'unsupported':
      return (
        'Installing it needs mip on the board, so use a firmware build that includes mip, ' +
        'or copy the driver into the library folder yourself with the Files panel.'
      )
    case 'too-big':
      return (
        'Install it from a firmware build that includes mip, or copy the files into the ' +
        'library folder yourself with the Files panel.'
      )
    case 'malformed':
    default:
      return (
        "Snakie couldn't read the package description; install it from a firmware build that " +
        'includes mip, or copy the driver into the library folder yourself with the Files panel.'
      )
  }
}

/**
 * The message shown when a `mip`-sourced module could not be installed by
 * EITHER route. One line on purpose: the Driver Install banner and the parts
 * banner both surface a failure by taking the log's last line, so a multi-line
 * explanation would show the user only its tail.
 *
 * It always names four things — the module, that the board has no `mip` and why
 * that is normal, what Snakie tried instead and how that failed, and what to do
 * — so it can never degrade into the bare `ImportError` this replaced.
 */
export function mipInstallFailureMessage(options: {
  /** The driver's display name. */
  moduleName: string
  /** The `mip` spec Snakie tried to resolve. */
  spec: string
  /** Why the host route failed. */
  kind: MipFailureKind
  /** The underlying detail (a URL and status, a timeout, …). */
  detail: string
  /** The board's runtime, when known — names the firmware in the message. */
  runtime?: RuntimeInfo | null
}): string {
  const { moduleName, spec, kind, detail, runtime } = options
  const label = runtimeLabel(runtime ?? null)
  const firmware = label ? `this board's firmware (${label})` : "this board's firmware"
  return (
    `Couldn't install ${moduleName}: ${firmware} has no ${MIP_IS} — ${MIP_IS_OPTIONAL}. ` +
    `Snakie tried to download ${spec} on your computer and copy it to the board instead, ` +
    `but that failed: ${detail}. ${advice(kind)}`
  ).replace(/\s+/g, ' ')
}
