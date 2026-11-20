import { useEffect, useRef } from 'react'
import type React from 'react'

/** How long a finger must rest before it counts as a long press. */
export const LONG_PRESS_MS = 500
/** How far (CSS px) a finger may drift and still be "resting" — beyond this it
 *  is a scroll or a drag, and the press is abandoned. */
export const LONG_PRESS_SLOP = 10

/** The part of a mouse event a context menu needs to place itself. A real
 *  right-click supplies it; so does a long press. */
export type MenuAnchorEvent = Pick<
  React.MouseEvent,
  'clientX' | 'clientY' | 'preventDefault' | 'stopPropagation'
>

export interface LongPressHandlers {
  onPointerDown: (e: React.PointerEvent) => void
  onPointerMove: (e: React.PointerEvent) => void
  onPointerUp: () => void
  onPointerCancel: () => void
  onPointerLeave: () => void
  onContextMenu: (e: React.MouseEvent) => void
  onClickCapture: (e: React.MouseEvent) => void
}

/**
 * Press-and-hold = right-click, for touch. iOS Safari never sends `contextmenu`
 * for a long press, so anything reachable only by right-click is unreachable on
 * an iPhone or iPad. This opens the same menu from a held finger.
 *
 * Spread the returned handlers on the element and pass the menu opener as
 * `onMenu`. Mouse right-clicks still arrive through `onContextMenu`; where the
 * browser ALSO sends its own `contextmenu` for the hold (Android), that second
 * event is swallowed, and so is the click a lifted finger would otherwise send
 * to the row underneath.
 */
export function useLongPress(onMenu: ((e: MenuAnchorEvent) => void) | undefined): LongPressHandlers {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const start = useRef<{ x: number; y: number } | null>(null)
  const firedAt = useRef(0)
  const menuRef = useRef(onMenu)
  menuRef.current = onMenu

  const cancel = (): void => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    start.current = null
  }
  useEffect(() => cancel, [])

  const justFired = (): boolean => Date.now() - firedAt.current < 800

  return {
    onPointerDown: (e) => {
      if (e.pointerType === 'mouse' || !menuRef.current) return
      cancel()
      const at = { x: e.clientX, y: e.clientY }
      start.current = at
      timer.current = setTimeout(() => {
        timer.current = null
        start.current = null
        firedAt.current = Date.now()
        menuRef.current?.({
          clientX: at.x,
          clientY: at.y,
          preventDefault: () => {},
          stopPropagation: () => {}
        })
      }, LONG_PRESS_MS)
    },
    onPointerMove: (e) => {
      const s = start.current
      if (s && Math.hypot(e.clientX - s.x, e.clientY - s.y) > LONG_PRESS_SLOP) cancel()
    },
    onPointerUp: cancel,
    onPointerCancel: cancel,
    onPointerLeave: cancel,
    onContextMenu: (e) => {
      if (justFired()) {
        e.preventDefault() // the browser's own event for the hold we already handled
        return
      }
      cancel()
      menuRef.current?.(e)
    },
    onClickCapture: (e) => {
      if (!justFired()) return
      e.preventDefault()
      e.stopPropagation()
    }
  }
}
