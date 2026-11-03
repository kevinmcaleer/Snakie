/**
 * LOADING THE PROGRAM, AND THE LINKS BACK (#1286, #1287).
 * =============================================================================
 *
 * An embed shows one file from a GitHub gist or repo. Both are readable from a
 * browser with no key:
 *
 *  - **gists**: when the file name is known, straight from the raw file on
 *    `gist.githubusercontent.com` (no rate limit). Otherwise through the Gist
 *    API (`api.github.com/gists/<id>`), which tells us the file names and the
 *    owner — but unauthenticated it allows only 60 requests an hour per
 *    reader's IP, so when it refuses we fall back to the gist's raw first file.
 *  - **repo files** straight from `raw.githubusercontent.com`. With no `ref`
 *    we try `main`, then `master`, since both are still common.
 *
 * The same module builds the two footer links — **View on GitHub** and **Open
 * in Snakie** — so they always describe the file that was actually loaded.
 */
import type { EmbedLines, EmbedSource } from './params'
import { decodeCode, encodeCode } from './share'

export interface LoadedProgram {
  /** File name, shown in the toolbar and used for the Open in Snakie tab. */
  name: string
  code: string
  /** The page on GitHub this came from (null for inline code). */
  githubUrl: string | null
  /** The source with every guess resolved (file name, ref) — for Open in Snakie. */
  source: EmbedSource
  /**
   * Every file of a gist, when it has more than one and the URL didn't name
   * one — GitHub's own embed shows them all, so the toolbar offers the rest.
   */
  files?: { name: string; code: string }[]
}

export type Fetcher = (url: string) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>

export class EmbedLoadError extends Error {
  constructor(
    message: string,
    /** Where a reader can still see the code — the footer keeps this link. */
    readonly githubUrl: string | null
  ) {
    super(message)
  }
}

interface GistFile {
  filename?: string
  content?: string
  truncated?: boolean
  raw_url?: string
  language?: string | null
}

interface GistResponse {
  html_url?: string
  owner?: { login?: string } | null
  files?: Record<string, GistFile>
}

/** GitHub's anchor for a file inside a gist page: `#file-main-py`. */
export function gistFileAnchor(file: string): string {
  return 'file-' + file.toLowerCase().replace(/[^a-z0-9]+/g, '-')
}

export function githubUrlFor(source: EmbedSource, lines: EmbedLines | null = null): string | null {
  if (source.kind === 'gist') {
    const base = `https://gist.github.com/${source.user ? source.user + '/' : ''}${source.id}${source.revision ? '/' + source.revision : ''}`
    return source.file ? `${base}#${gistFileAnchor(source.file)}` : base
  }
  if (source.kind === 'repo') {
    const path = source.path.split('/').map(encodeURIComponent).join('/')
    const anchor =
      lines && lines.to !== Number.MAX_SAFE_INTEGER
        ? lines.from === lines.to
          ? `#L${lines.from}`
          : `#L${lines.from}-L${lines.to}`
        : lines
          ? `#L${lines.from}`
          : ''
    return `https://github.com/${source.owner}/${source.name}/blob/${encodeURIComponent(source.ref ?? 'main')}/${path}${anchor}`
  }
  return null
}

/** Pick the file to show: the one asked for, else the first Python file, else the first. */
export function pickGistFile(files: Record<string, GistFile>, wanted: string | null): string | null {
  const names = Object.keys(files)
  if (names.length === 0) return null
  if (wanted) return names.find((n) => n === wanted) ?? names.find((n) => n.toLowerCase() === wanted.toLowerCase()) ?? null
  return names.find((n) => /\.py$/i.test(n)) ?? names[0]
}

// The raw text of a gist file (or, with no name, its first file). The user
// segment isn't checked by GitHub, but it has to be there.
function rawGistUrl(source: Extract<EmbedSource, { kind: 'gist' }>, file: string | null): string {
  const tail = [source.revision, file ? encodeURIComponent(file) : null].filter(Boolean).join('/')
  return `https://gist.githubusercontent.com/${source.user ?? 'anonymous'}/${source.id}/raw${tail ? '/' + tail : ''}`
}

async function fetchText(fetcher: Fetcher, url: string): Promise<string | null> {
  try {
    const r = await fetcher(url)
    return r.ok ? await r.text() : null
  } catch {
    return null
  }
}

async function loadGist(
  source: Extract<EmbedSource, { kind: 'gist' }>,
  fetcher: Fetcher
): Promise<LoadedProgram> {
  const page = githubUrlFor(source)
  // A named file needs no API call (and so no rate limit).
  if (source.file) {
    const code = await fetchText(fetcher, rawGistUrl(source, source.file))
    if (code !== null) return { name: source.file, code, githubUrl: page, source }
  }
  const api = `https://api.github.com/gists/${source.id}${source.revision ? '/' + source.revision : ''}`
  let res: Awaited<ReturnType<Fetcher>> | null = null
  try {
    res = await fetcher(api)
  } catch {
    res = null
  }
  if (res && res.ok) {
    const data = JSON.parse(await res.text()) as GistResponse
    const files = data.files ?? {}
    const name = pickGistFile(files, source.file)
    if (!name) {
      throw new EmbedLoadError(
        source.file ? `This gist has no file called ${source.file}.` : 'This gist has no files.',
        page
      )
    }
    const file = files[name]
    let code = file.content ?? ''
    if (file.truncated && file.raw_url) {
      const raw = await fetcher(file.raw_url)
      if (raw.ok) code = await raw.text()
    }
    const resolved = { ...source, file: name, user: source.user ?? data.owner?.login ?? null }
    const names = Object.keys(files)
    const all =
      !source.file && names.length > 1
        ? names.map((n) => ({ name: n, code: n === name ? code : files[n].content ?? '' }))
        : undefined
    return { name, code, githubUrl: githubUrlFor(resolved), source: resolved, ...(all ? { files: all } : {}) }
  }
  if (res && res.status === 404) throw new EmbedLoadError("That gist doesn't exist, or it is secret.", page)
  // Rate-limited (403/429) or offline, with no file name: the gist's raw
  // address with no name gives its first file. We can't learn the name, so
  // call it main.py.
  if (!source.file) {
    const code = await fetchText(fetcher, rawGistUrl(source, null))
    if (code !== null) return { name: 'main.py', code, githubUrl: page, source }
  }
  throw new EmbedLoadError(
    'GitHub is busy (too many requests from this network), so the code could not load. Try again in a few minutes.',
    page
  )
}

async function loadRepo(
  source: Extract<EmbedSource, { kind: 'repo' }>,
  fetcher: Fetcher
): Promise<LoadedProgram> {
  const refs = source.ref ? [source.ref] : ['main', 'master']
  const path = source.path.split('/').map(encodeURIComponent).join('/')
  const name = source.path.split('/').pop() ?? source.path
  for (const ref of refs) {
    let res: Awaited<ReturnType<Fetcher>>
    try {
      res = await fetcher(`https://raw.githubusercontent.com/${source.owner}/${source.name}/${encodeURIComponent(ref)}/${path}`)
    } catch {
      throw new EmbedLoadError("Couldn't reach GitHub to load the code.", githubUrlFor({ ...source, ref }))
    }
    if (res.ok) {
      const resolved = { ...source, ref }
      return { name, code: await res.text(), githubUrl: githubUrlFor(resolved), source: resolved }
    }
  }
  throw new EmbedLoadError(
    `Couldn't find ${source.path} in ${source.owner}/${source.name}. It may be private, renamed or on another branch.`,
    githubUrlFor({ ...source, ref: refs[0] })
  )
}

export async function loadProgram(source: EmbedSource, fetcher: Fetcher): Promise<LoadedProgram> {
  if (source.kind === 'gist') return loadGist(source, fetcher)
  if (source.kind === 'repo') return loadRepo(source, fetcher)
  if (source.kind === 'inline') {
    // A payload from `encodeCode`, or plain (URL-encoded) text.
    const code = decodeCode(source.code) ?? source.code
    return { name: source.name, code, githubUrl: null, source }
  }
  throw new EmbedLoadError('No code to show: the embed needs a gist, a repo file or some code.', null)
}

/** The query string that names a source to the embed or the full app. */
export function sourceQuery(source: EmbedSource): URLSearchParams {
  const q = new URLSearchParams()
  if (source.kind === 'gist') {
    q.set('gist', source.user ? `${source.user}/${source.id}` : source.id)
    if (source.file) q.set('file', source.file)
    if (source.revision) q.set('revision', source.revision)
  } else if (source.kind === 'repo') {
    q.set('repo', `${source.owner}/${source.name}`)
    q.set('path', source.path)
    if (source.ref) q.set('ref', source.ref)
  } else if (source.kind === 'inline') {
    q.set('name', source.name)
  }
  return q
}

/**
 * The full app's URL with this file loaded (#1287). The code the embed shows
 * rides in the hash — `#code=` when the reader edited it, `#src=` for the
 * original — so the app opens it without asking GitHub again (whose API may
 * be rate-limiting this reader), and it never reaches a server log. The query
 * still names the source, for the tab name and the "from" note.
 */
export function openInSnakieUrl(
  appOrigin: string,
  source: EmbedSource,
  code: string | null,
  name: string,
  edited = false
): string {
  const q = sourceQuery(source)
  if (source.kind === 'inline' && !q.has('name')) q.set('name', name)
  if (source.kind === 'gist' && !q.has('file') && name) q.set('file', name)
  const query = q.toString()
  const text = code ?? (source.kind === 'inline' ? decodeCode(source.code) ?? source.code : null)
  const hash = text !== null ? `#${edited ? 'code' : 'src'}=${encodeCode(text)}` : ''
  return `${appOrigin.replace(/\/+$/, '')}/${query ? '?' + query : ''}${hash}`
}
