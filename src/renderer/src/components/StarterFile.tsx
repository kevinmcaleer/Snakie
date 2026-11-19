import { useEffect, useRef } from 'react'
import { useWorkspace } from '../store/workspace'
import { RESTORE_GUARD_KEY } from '../store/session-restore'
import {
  STARTER_CODE,
  STARTER_NAME,
  hasOpenLink,
  settleStarter,
  shouldOpenStarter,
  starterSettled,
  starterUntouched
} from '../store/starter-file'

/**
 * Opens the starter program on a brand-new user's first launch — see
 * store/starter-file.ts for when, and why only once. Renders nothing.
 */
export function StarterFile(): null {
  const { openFiles, openBuffer } = useWorkspace()
  const tabs = useRef(openFiles.length)
  tabs.current = openFiles.length
  const ran = useRef(false)
  const shown = useRef(false)

  useEffect(() => {
    if (ran.current) return
    ran.current = true
    let storage: Storage
    try {
      storage = window.localStorage
    } catch {
      return
    }
    if (starterSettled(storage)) return
    // Read the address now: an "Open in Snakie" link is taken off it once opened.
    const openLink = hasOpenLink(window.location.search, window.location.hash)
    void (async () => {
      // Let the session restore finish first — it decides how many tabs there are.
      await new Promise((r) => requestAnimationFrame(() => r(null)))
      for (let i = 0; i < 50; i++) {
        let busy = false
        try {
          busy = storage.getItem(RESTORE_GUARD_KEY) !== null
        } catch {
          busy = false
        }
        if (!busy) break
        await new Promise((r) => setTimeout(r, 100))
      }
      if (shouldOpenStarter({ settled: false, openTabs: tabs.current, openLink })) {
        openBuffer(STARTER_NAME, STARTER_CODE)
        shown.current = true
      } else settleStarter(storage)
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on first mount
  }, [])

  // The starter stays on offer until the user has done something with Snakie:
  // an untouched starter is gone after a reload (unsaved buffers are not
  // restored), and a first-timer who reloads should not land on an empty
  // editor. Editing it, closing it or opening anything else settles it.
  useEffect(() => {
    if (!shown.current) return
    if (starterUntouched(openFiles)) return
    shown.current = false
    try {
      settleStarter(window.localStorage)
    } catch {
      /* storage unavailable — nothing to remember */
    }
  }, [openFiles])

  return null
}
