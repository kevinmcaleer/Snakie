/**
 * THE EMBED'S URL (#1286, epic #1285).
 * =============================================================================
 *
 * Everything an embed shows is decided by its query string, so a tutorial can
 * say what it wants in one `<iframe src>` (or one `data-*` element, via
 * `snakie-embed.js`). This module turns that string into a typed, clamped,
 * defaulted description and nothing else: no DOM, no fetch, so the rules are
 * unit-tested in plain node.
 *
 * ```
 * /embed.html?gist=<id>&file=main.py
 * /embed.html?repo=owner/name&path=src/main.py&ref=main&lines=10-40
 * /embed.html?code=<base64url deflate>&name=main.py   (inline, no GitHub)
 *   &view=code|blocks|split   &views=0|1   &toolbox=basic|advanced   &run=0|1
 *   &autorun=1  &theme=skeuomorph|dark  &height=auto|<px>
 *   &engine=micropython|pyodide  &packages=numpy,pandas  &id=<host's id>
 * ```
 */

export type EmbedView = 'code' | 'blocks' | 'split'
export type EmbedEngineId = 'micropython' | 'pyodide'
export type EmbedTheme = 'skeuomorph' | 'dark'
export type EmbedToolbox = 'simple' | 'advanced'

/** Where the program comes from. */
export type EmbedSource =
  | { kind: 'gist'; id: string; user: string | null; file: string | null; revision: string | null }
  | { kind: 'repo'; owner: string; name: string; path: string; ref: string | null }
  | { kind: 'inline'; code: string; name: string }
  | { kind: 'none' }

export interface EmbedLines {
  from: number
  to: number
}

export interface EmbedParams {
  source: EmbedSource
  /** Inclusive 1-based line range to show, or null for the whole file. */
  lines: EmbedLines | null
  /** `null` = decide from the file (blocks if it carries a blocks footer). */
  view: EmbedView | null
  /** Show the Code / Split / Blocks switch (when the file can be blocks). */
  views: boolean
  toolbox: EmbedToolbox
  /** Show Run and the REPL. `false` is a read-only viewer. */
  run: boolean
  autorun: boolean
  theme: EmbedTheme
  /** `null` = auto (the helper sizes the iframe to the content). */
  height: number | null
  engine: EmbedEngineId
  /** Extra Pyodide packages to load before running (imports are also detected). */
  packages: string[]
  /** The host's id for this embed, echoed in every `postMessage`. */
  id: string | null
}

/** GitHub owner / repo names: letters, digits, `-`, `_`, `.`. */
const NAME_RE = /^[A-Za-z0-9_.-]+$/
/** Gist ids are hex; very old ones are numeric. */
const GIST_RE = /^[A-Za-z0-9]+$/
const PACKAGE_RE = /^[A-Za-z0-9_.-]+$/

export const MIN_HEIGHT = 160
export const MAX_HEIGHT = 2000

function clean(value: string | null): string | null {
  const v = value?.trim()
  return v ? v : null
}

function flag(value: string | null, fallback: boolean): boolean {
  if (value === null) return fallback
  const v = value.trim().toLowerCase()
  if (v === '' || v === '1' || v === 'true' || v === 'yes' || v === 'on') return true
  if (v === '0' || v === 'false' || v === 'no' || v === 'off') return false
  return fallback
}

/** `10-40`, `10:40`, `10` (one line), `10-` (to the end). */
export function parseLines(value: string | null): EmbedLines | null {
  const v = clean(value)
  if (!v) return null
  const m = /^(\d+)\s*(?:[-:]\s*(\d*))?$/.exec(v)
  if (!m) return null
  const from = Number(m[1])
  const to = m[2] === undefined ? from : m[2] === '' ? Number.MAX_SAFE_INTEGER : Number(m[2])
  if (from < 1 || to < from) return null
  return { from, to }
}

/** Keep only the requested lines (1-based, inclusive), clamped to the file. */
export function sliceLines(code: string, lines: EmbedLines | null): string {
  if (!lines) return code
  const all = code.split('\n')
  return all.slice(lines.from - 1, Math.min(all.length, lines.to)).join('\n')
}

/**
 * A path inside a repo. Leading slashes go; `..` and empty segments are
 * refused, since they could only ever be a mistake in a URL we build.
 */
function cleanPath(value: string | null): string | null {
  const v = clean(value)?.replace(/^\/+/, '')
  if (!v) return null
  const parts = v.split('/')
  if (parts.some((p) => p === '' || p === '.' || p === '..')) return null
  return v
}

function parseSource(q: URLSearchParams): EmbedSource {
  const gist = clean(q.get('gist'))
  if (gist) {
    // Accept `user/<id>` or a whole gist URL: https://gist.github.com/user/<id>
    const parts = gist.replace(/^https:\/\/gist\.github\.com\//, '').replace(/\/+$/, '').split('/')
    const id = parts.pop() ?? ''
    const userRaw = parts.pop() ?? clean(q.get('user'))
    const user = userRaw && NAME_RE.test(userRaw) ? userRaw : null
    if (GIST_RE.test(id)) {
      return {
        kind: 'gist',
        id,
        user,
        file: clean(q.get('file')),
        revision: clean(q.get('revision'))
      }
    }
  }
  const repo = clean(q.get('repo'))
  const path = cleanPath(q.get('path') ?? q.get('file'))
  if (repo && path) {
    const [owner, name, ...rest] = repo.replace(/^https:\/\/github\.com\//, '').split('/')
    if (owner && name && rest.length === 0 && NAME_RE.test(owner) && NAME_RE.test(name)) {
      // No ref → the loader tries `main`, then `master`.
      const ref = clean(q.get('ref'))
      return { kind: 'repo', owner, name: name.replace(/\.git$/, ''), path, ref }
    }
  }
  const code = q.get('code')
  if (code !== null) {
    return { kind: 'inline', code, name: clean(q.get('name')) ?? 'main.py' }
  }
  return { kind: 'none' }
}

export function parseEmbedParams(search: string): EmbedParams {
  const q = new URLSearchParams(search)
  const viewRaw = clean(q.get('view'))?.toLowerCase()
  const view: EmbedView | null =
    viewRaw === 'code' || viewRaw === 'python'
      ? 'code'
      : viewRaw === 'blocks' || viewRaw === 'split'
        ? viewRaw
        : null
  const toolboxRaw = clean(q.get('toolbox'))?.toLowerCase()
  const toolbox: EmbedToolbox = toolboxRaw === 'advanced' ? 'advanced' : 'simple'
  const themeRaw = clean(q.get('theme'))?.toLowerCase()
  const theme: EmbedTheme = themeRaw === 'dark' ? 'dark' : 'skeuomorph'
  const engineRaw = clean(q.get('engine'))?.toLowerCase()
  const engine: EmbedEngineId =
    engineRaw === 'pyodide' || engineRaw === 'python' || engineRaw === 'cpython'
      ? 'pyodide'
      : 'micropython'
  const heightRaw = clean(q.get('height'))
  const heightNum = heightRaw && /^\d+$/.test(heightRaw) ? Number(heightRaw) : null
  const height =
    heightNum === null ? null : Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, heightNum))
  const packages = (clean(q.get('packages')) ?? '')
    .split(',')
    .map((p) => p.trim())
    .filter((p) => p && PACKAGE_RE.test(p))
  const id = clean(q.get('id'))
  return {
    source: parseSource(q),
    lines: parseLines(q.get('lines')),
    // Pyodide runs CPython, which the blocks don't write — so it is code only.
    view: engine === 'pyodide' ? 'code' : view,
    views: flag(q.get('views'), true),
    toolbox,
    run: flag(q.get('run'), true),
    autorun: flag(q.get('autorun'), false),
    theme,
    height,
    engine,
    packages,
    id: id && id.length <= 100 ? id : null
  }
}
