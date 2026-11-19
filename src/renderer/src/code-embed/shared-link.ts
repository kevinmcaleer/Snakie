/**
 * WHAT AN "OPEN IN SNAKIE" LINK OPENS (#1287, kevsrobots.com#581).
 * =============================================================================
 *
 * The rules behind `OpenFromUrl`, kept free of React and the DOM so they are
 * unit-tested in plain node. A link is a query (`?gist=…`, `?repo=…&path=…`,
 * `?name=…`, `?code=…`) plus a hash carrying the code (`#src=…` original,
 * `#code=…` edited), from the web app's address bar or a `snakie://open…` link.
 */
import { parseEmbedParams } from './params'
import { loadProgram, type Fetcher } from './source'
import { decodeCode } from './share'

export interface SharedProgram {
  name: string
  code: string
  /** The status-bar note: where it came from. */
  note: string
}

/**
 * The program a link describes, or null when it names none. Throws (with a
 * reader-facing message) when it names one that can't be loaded.
 */
export async function resolveSharedLink(
  search: string,
  hash: string,
  fetcher: Fetcher
): Promise<SharedProgram | null> {
  const params = parseEmbedParams(search)
  // `#code=` is the reader's edit; `#src=` is the original, sent along so we
  // needn't ask GitHub again (its API rate-limits readers to 60 an hour).
  const hashOf = (key: string): string | null => {
    const raw = new RegExp(`(?:^#|&)${key}=([A-Za-z0-9_-]+)`).exec(hash)?.[1]
    return raw ? decodeCode(raw) : null
  }
  const edited = hashOf('code')
  const carried = edited ?? hashOf('src')
  if (params.source.kind === 'none' && carried === null) return null

  // A bare `?name=` names code that rides in the hash (a lesson's code block).
  const named = new URLSearchParams(search).get('name')?.trim()
  let name =
    params.source.kind === 'inline' ? params.source.name : named && named.length <= 100 ? named : 'main.py'
  let code = carried
  let from = 'the link'
  if (params.source.kind === 'gist' || params.source.kind === 'repo') {
    from = params.source.kind === 'gist' ? 'a GitHub gist' : `${params.source.owner}/${params.source.name}`
    if (carried !== null) {
      // The embed sent the code: no need to load it again.
      name =
        params.source.kind === 'gist'
          ? params.source.file ?? 'main.py'
          : params.source.path.split('/').pop() ?? 'main.py'
    } else {
      const program = await loadProgram(params.source, fetcher)
      name = program.name
      code = program.code
    }
  } else if (params.source.kind === 'inline' && code === null) {
    code = decodeCode(params.source.code) ?? params.source.code
  }
  if (code === null) return null
  return {
    name,
    code,
    note: edited !== null ? `Opened ${name} (edited from the original)` : `Opened ${name} from ${from}`
  }
}
