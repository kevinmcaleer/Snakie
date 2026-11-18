import { useEffect, useState } from 'react'

/**
 * Small-screen layout (design option C, "editor first + pull-up
 * sheet"). The shell has three sizes:
 *
 * - `wide`    — the desktop layout: files | editor over console | instrument dock.
 * - `compact` — small laptops and tablets: the editor fills the width, the Files
 *               panel slides over it as a drawer, and the console, board and
 *               instruments share one pull-up sheet under the editor.
 * - `phone`   — compact, plus the activity bar folds into the ☰ drawer and the
 *               toolbar drops to icons.
 */
export type ViewportSize = 'wide' | 'compact' | 'phone'

/** Widths (CSS px, inclusive) at or below which each smaller layout applies. */
export const COMPACT_MAX_WIDTH = 1100
export const PHONE_MAX_WIDTH = 640

export function viewportSizeFor(width: number): ViewportSize {
  if (width <= PHONE_MAX_WIDTH) return 'phone'
  if (width <= COMPACT_MAX_WIDTH) return 'compact'
  return 'wide'
}

function currentSize(): ViewportSize {
  if (typeof window === 'undefined') return 'wide'
  return viewportSizeFor(window.innerWidth)
}

/** The shell's current layout size, tracking window resizes. */
export function useViewportSize(): ViewportSize {
  const [size, setSize] = useState<ViewportSize>(currentSize)
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const queries = [
      window.matchMedia(`(max-width: ${COMPACT_MAX_WIDTH}px)`),
      window.matchMedia(`(max-width: ${PHONE_MAX_WIDTH}px)`)
    ]
    const update = (): void => setSize(currentSize())
    for (const q of queries) q.addEventListener('change', update)
    update()
    return () => {
      for (const q of queries) q.removeEventListener('change', update)
    }
  }, [])
  return size
}
