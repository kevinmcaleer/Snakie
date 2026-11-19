/**
 * `snakie://` LINKS — "Open in Snakie" for the desktop app (kevsrobots.com#581).
 * =============================================================================
 *
 * A lesson on kevsrobots.com (or a Snakie code embed) opens the web app with
 * `https://app.snakie.org/?name=main.py#src=<code>`. The desktop app takes the
 * very same query and hash behind its own scheme:
 *
 * ```
 * snakie://open?name=blink.py#src=<base64url deflate>
 * snakie://open?gist=user/<id>&file=main.py
 * snakie://open?repo=owner/name&path=main.py&ref=main
 * ```
 *
 * so one link builder serves both. This module only checks the link's shape
 * and hands back the `?…#…` part; the renderer's "Open in Snakie" code reads
 * it exactly as it reads the web app's address bar. No DOM, no Electron, so it
 * is unit-tested in plain node.
 */

export const DEEP_LINK_SCHEME = 'snakie'

/** Links longer than this are refused: a lesson is a few KB, not megabytes. */
export const MAX_DEEP_LINK_LENGTH = 512 * 1024

/** The parts of an "open" link that the renderer reads. */
export interface DeepLinkPayload {
  /** `?gist=…`, `?repo=…&path=…`, `?name=…` or '' */
  search: string
  /** `#src=…`, `#code=…` or '' */
  hash: string
}

/**
 * The query and hash of a `snakie://open…` link, or null for anything else
 * (another scheme, another action, too long, or nothing to open).
 */
export function parseDeepLink(url: unknown): DeepLinkPayload | null {
  if (typeof url !== 'string' || url.length > MAX_DEEP_LINK_LENGTH) return null
  const m = /^snakie:(?:\/\/)?open\/?(\?[^#]*)?(#.*)?$/i.exec(url.trim())
  if (!m) return null
  const search = m[1] && m[1] !== '?' ? m[1] : ''
  const hash = m[2] && m[2] !== '#' ? m[2] : ''
  if (!search && !hash) return null
  return { search, hash }
}

/** The first `snakie://` link in a command line (Windows and Linux pass it there). */
export function deepLinkFromArgv(argv: readonly string[]): string | null {
  for (const arg of argv) {
    if (typeof arg === 'string' && /^snakie:/i.test(arg)) return arg
  }
  return null
}
