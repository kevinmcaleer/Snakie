import { useEffect, useRef } from 'react'
import { useWorkspace } from '../store/workspace'
import { useWorkspaceLayout } from '../store/layout'
import { RESTORE_GUARD_KEY } from '../store/session-restore'
import { IS_WEB } from '../lib/env'
import type { Fetcher } from './source'
import { resolveSharedLink, workspaceForSharedCode, type SharedProgram } from './shared-link'

/**
 * "OPEN IN SNAKIE" — the full app's half (#1287, epic #1285; kevsrobots.com#581).
 * =============================================================================
 *
 * The code embed's footer, and the button on kevsrobots lesson code, link to
 * `app.snakie.org/?gist=<id>&file=main.py` (or `?repo=owner/name&path=…&ref=…`,
 * or `?name=main.py` for code with no GitHub home), with the code itself
 * compressed into the hash: `#src=…` for the original, `#code=…` when the
 * reader edited it. On start-up this opens that file as a NEW unsaved tab
 * named after it, using the embed's own loader. It never replaces anything:
 * the learner's restored files stay open beside it, and Save asks where to put
 * it, as for any new buffer. A blocks file (one with the blocks footer) opens
 * on the canvas, as it would from disk.
 *
 * On the web the parameters are then taken off the address bar, so a reload
 * doesn't open a second copy. The desktop app gets the same `?…#…` from a
 * `snakie://open…` link (src/main/deepLink.ts), at start-up or while running.
 */

/** The desktop renderer's CSP blocks GitHub, so main reads it for us. */
const desktopFetcher: Fetcher = async (url) => {
  const res = await window.api.openLinks.fetchGithubText(url)
  return { ok: res.ok, status: res.status, text: async () => res.body }
}

export function OpenFromUrl(): null {
  const { openBuffer } = useWorkspace()
  const { active, switchWorkspace } = useWorkspaceLayout()
  // The effect runs once; read the workspace that is showing NOW, not at mount.
  const activeRef = useRef(active)
  activeRef.current = active

  useEffect(() => {
    let cancelled = false
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
    const open = async (search: string, hash: string, fetcher: Fetcher): Promise<boolean> => {
      let program: SharedProgram | null
      try {
        program = await resolveSharedLink(search, hash, fetcher)
      } catch (err) {
        if (!cancelled) status(`Couldn't open the shared code: ${err instanceof Error ? err.message : String(err)}`)
        return true
      }
      if (!program || cancelled) return program !== null
      await afterRestore()
      if (cancelled) return true
      openBuffer(program.name, program.code)
      // Snakie reopens on the workspace you last used — Electronics or Build
      // don't put the editor in front, so a lesson's code would open unseen.
      const target = workspaceForSharedCode(program.code, activeRef.current)
      if (target) switchWorkspace(target)
      status(program.note, 'Not saved yet. Save it to keep a copy.')
      return true
    }

    if (IS_WEB) {
      const clearUrl = (): void => {
        try {
          window.history.replaceState(null, '', window.location.pathname)
        } catch {
          /* not fatal */
        }
      }
      void open(window.location.search, window.location.hash, (url) => fetch(url)).then((handled) => {
        if (handled && !cancelled) clearUrl()
      })
      return () => {
        cancelled = true
      }
    }

    // Desktop: `snakie://open…` links (kevsrobots.com#581).
    const links = window.api.openLinks
    if (!links) return
    // One at a time, in the order they came, so tabs open in that order.
    let queue = Promise.resolve()
    const enqueue = (link: { search: string; hash: string }): void => {
      queue = queue.then(() => open(link.search, link.hash, desktopFetcher).then(() => undefined))
    }
    const off = links.onOpen(enqueue)
    void links.take().then((pending) => {
      if (!cancelled) pending.forEach(enqueue)
    })
    return () => {
      cancelled = true
      if (typeof off === 'function') off()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, at start-up
  }, [])

  return null
}

export default OpenFromUrl
