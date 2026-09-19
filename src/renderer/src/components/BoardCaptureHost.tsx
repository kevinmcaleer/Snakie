/**
 * THE APP'S OFF-SCREEN BOARD, for the PDF export (#1110, #1147).
 *
 * Renders nothing at all until `lib/pdf/wiring-capture` asks for a board it can
 * photograph; then it portals a `<BoardPane>` into the off-screen host the
 * exporter provides — on the mat it asked for — and takes it down again when
 * the capture is done.
 *
 * It lives in `App.tsx`, INSIDE the providers, for the reason written up in
 * `board-capture-registry.ts`: a `<BoardPane>` mounted anywhere else has no
 * workspace above it and throws on its first render. A portal keeps the React
 * tree — and so the context — while putting the DOM where the exporter wants
 * it.
 *
 * `BoardPane` is lazy here exactly as it is in `AppShell`, so printing from a
 * session that never opened the Electronics view is the only thing that pulls
 * the board subsystem into the page.
 */

import { Suspense, lazy, useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { type CaptureMat, registerBoardCaptureMount } from './board-capture-registry'

const BoardPane = lazy(() => import('./BoardPane'))

export function BoardCaptureHost(): JSX.Element | null {
  const [asked, setAsked] = useState<{ host: HTMLElement; mat: CaptureMat } | null>(null)

  const mount = useCallback((host: HTMLElement, mat: CaptureMat) => {
    setAsked({ host, mat })
    // Unmount only OUR pane: a capture that finishes after a second one started
    // must not pull the second one's board out from under it.
    return () => setAsked((cur) => (cur?.host === host ? null : cur))
  }, [])

  useEffect(() => registerBoardCaptureMount(mount), [mount])

  if (!asked) return null
  // No fallback: the capture waits for the pane to say it is ready, so "still
  // loading" and "not there yet" are the same thing to it.
  return createPortal(
    <Suspense fallback={null}>
      <BoardPane mat={asked.mat} />
    </Suspense>,
    asked.host
  )
}
