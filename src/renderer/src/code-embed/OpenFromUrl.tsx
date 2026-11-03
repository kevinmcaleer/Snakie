import { useEffect } from 'react'
import { useWorkspace } from '../store/workspace'
import { RESTORE_GUARD_KEY } from '../store/session-restore'
import { parseEmbedParams } from './params'
import { loadProgram } from './source'
import { decodeCode } from './share'

/**
 * "OPEN IN SNAKIE" — the full web app's half (#1287, epic #1285).
 * =============================================================================
 *
 * The code embed's footer links to `app.snakie.org/?gist=<id>&file=main.py`
 * (or `?repo=owner/name&path=…&ref=…`), with the reader's edits — if they made
 * any — compressed into `#code=…`. On start-up this opens that file as a NEW
 * unsaved tab named after it, using the embed's own loader. It never replaces
 * anything: the learner's restored files stay open beside it, and Save asks
 * where to put it, as for any new buffer. A blocks file (one with the blocks
 * footer) opens on the canvas, as it would from disk.
 *
 * The parameters are then taken off the address bar, so a reload doesn't open
 * a second copy.
 */
export function OpenFromUrl(): null {
  const { openBuffer } = useWorkspace()

  useEffect(() => {
    const params = parseEmbedParams(window.location.search)
    // `#code=` is the reader's edit; `#src=` is the original, sent along so we
    // needn't ask GitHub again (its API rate-limits readers to 60 an hour).
    const hashOf = (key: string): string | null => {
      const raw = new RegExp(`(?:^#|&)${key}=([A-Za-z0-9_-]+)`).exec(window.location.hash)?.[1]
      return raw ? decodeCode(raw) : null
    }
    const edited = hashOf('code')
    const carried = edited ?? hashOf('src')
    if (params.source.kind === 'none' && carried === null) return
    let cancelled = false

    const clearUrl = (): void => {
      try {
        window.history.replaceState(null, '', window.location.pathname)
      } catch {
        /* not fatal */
      }
    }
    const status = (text: string, tooltip?: string): void => {
      window.dispatchEvent(new CustomEvent('snakie:status', { detail: { text, tooltip, priority: 6 } }))
    }
    // The session restore activates the last tab when it finishes; open after
    // it, or that would take the focus straight back off this file.
    const afterRestore = async (): Promise<void> => {
      await new Promise((r) => requestAnimationFrame(() => r(null)))
      for (let i = 0; i < 50; i++) {
        let busy = false
        try {
          busy = window.localStorage.getItem(RESTORE_GUARD_KEY) === '1'
        } catch {
          busy = false
        }
        if (!busy) return
        await new Promise((r) => setTimeout(r, 100))
      }
    }

    void (async () => {
      let name = params.source.kind === 'inline' ? params.source.name : 'main.py'
      let code = carried
      let from = 'the link'
      if (carried !== null && (params.source.kind === 'gist' || params.source.kind === 'repo')) {
        // The embed sent the code: no need to load it again.
        name =
          params.source.kind === 'gist'
            ? params.source.file ?? 'main.py'
            : params.source.path.split('/').pop() ?? 'main.py'
        from = params.source.kind === 'gist' ? 'a GitHub gist' : `${params.source.owner}/${params.source.name}`
      } else if (params.source.kind === 'gist' || params.source.kind === 'repo') {
        try {
          const program = await loadProgram(params.source, (url) => fetch(url))
          name = program.name
          code = program.code
          from = params.source.kind === 'gist' ? 'a GitHub gist' : `${params.source.owner}/${params.source.name}`
        } catch (err) {
          if (!cancelled) status(`Couldn't open the shared code: ${err instanceof Error ? err.message : String(err)}`)
          clearUrl()
          return
        }
      } else if (params.source.kind === 'inline' && code === null) {
        code = decodeCode(params.source.code) ?? params.source.code
      }
      if (code === null || cancelled) return
      await afterRestore()
      if (cancelled) return
      openBuffer(name, code)
      clearUrl()
      status(
        edited !== null ? `Opened ${name} (edited from the original)` : `Opened ${name} from ${from}`,
        'Not saved yet. Save it to keep a copy.'
      )
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, at start-up
  }, [])

  return null
}

export default OpenFromUrl
