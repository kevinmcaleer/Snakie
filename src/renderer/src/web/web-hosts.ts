/**
 * WHERE THE BROWSER BUILD IS ALLOWED TO FETCH FROM (#776 follow-on).
 * =============================================================================
 *
 * On the desktop, a package download runs in the Electron MAIN process, which
 * can reach any host on the internet. In the browser the same download runs on
 * the page, and a page is fenced in twice over:
 *
 *  1. **The CSP.** `connect-src` is a static allowlist baked into the built
 *     `index.html` (see `vite.web.config.ts`). A request to anything else is
 *     refused by the browser before it leaves.
 *  2. **CORS.** Even an allowlisted host is unreadable unless IT chooses to
 *     answer with `Access-Control-Allow-Origin`. That is not ours to configure,
 *     so it decides which hosts are worth allowlisting at all.
 *
 * Both fences are invisible from the call site: they surface as a bare
 * `TypeError: Failed to fetch`, which tells a user nothing. So the list lives
 * HERE, once, and does two jobs — it BUILDS the CSP directive (so the policy and
 * the code can never drift apart) and it is checked BEFORE fetching, so a spec
 * naming an unreachable host fails with a sentence that says what happened and
 * that the desktop app can do it.
 *
 * Pure and DOM-free: the vite config imports it at build time, the install path
 * imports it at run time, and the unit tests import it with neither.
 */

/**
 * Every origin the web build may open a connection to, plus `'self'`.
 *
 * Each entry is a CSP host-source AND a browser-reachable origin, i.e. every
 * one of them answers with `Access-Control-Allow-Origin: *`:
 *
 *  - `projects.kevsrobots.com` — the feedback API bug reports POST to (#513).
 *  - `raw.githubusercontent.com` — every `github:` spec in the module catalog.
 *  - `micropython.org` — the micropython-lib package index `mip` resolves bare
 *    names against (`/pi/v2/package/py/…`, `/pi/v2/file/…`).
 *  - `pypi.org` — the JSON API package search reads descriptions from.
 *
 * Deliberately absent: `gitlab.com`. `gitlab:` specs rewrite to its raw file
 * endpoint, which sends NO CORS header, so a page cannot read it however the
 * CSP is written — allowlisting it would trade a clear refusal for a mystery.
 */
export const WEB_CONNECT_ORIGINS: readonly string[] = [
  'https://projects.kevsrobots.com',
  'https://raw.githubusercontent.com',
  'https://micropython.org',
  'https://pypi.org'
]

/** The `connect-src` directive for the web build's CSP, built from the list
 *  above so the policy is never edited without the code agreeing. */
export function webConnectSrc(): string {
  return `connect-src 'self' ${WEB_CONNECT_ORIGINS.join(' ')}`
}

/**
 * Can the page actually fetch `url`? True only for an exact-origin match on
 * {@link WEB_CONNECT_ORIGINS} — CSP host-sources match no subdomains and no
 * other port, so neither does this. A URL that doesn't parse is a no.
 */
export function webCanFetch(url: string): boolean {
  let origin: string
  try {
    origin = new URL(url).origin
  } catch {
    return false
  }
  return WEB_CONNECT_ORIGINS.includes(origin)
}

/**
 * The one-line reason a fetch was refused before it was attempted. Names the
 * host that was asked for, the ones that work, and the way out — because the
 * limitation is the BROWSER's, and the desktop app genuinely doesn't have it.
 */
export function webFetchRefusal(url: string): string {
  let host: string
  try {
    host = new URL(url).host
  } catch {
    host = url
  }
  const allowed = WEB_CONNECT_ORIGINS.map((o) => new URL(o).host).join(', ')
  return (
    `a web page may only download from ${allowed}, and ${host} is not one of them ` +
    '(the browser blocks the rest) — install this one from the Snakie desktop app'
  )
}
