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
 *               toolbar drops to icons. A phone held in LANDSCAPE is still a
 *               phone: it is wide enough to read as `compact`, but only ~370–440px
 *               tall, so a short compact window is treated as `phone` too.
 */
export type ViewportSize = 'wide' | 'compact' | 'phone'

/** Widths (CSS px, inclusive) at or below which each smaller layout applies. */
export const COMPACT_MAX_WIDTH = 1100
export const PHONE_MAX_WIDTH = 640
/** Height (CSS px, inclusive) at or below which a compact-width window is a
 *  phone in landscape. The largest phones are ~440px tall on their side; the
 *  smallest tablets are 600px+. */
export const PHONE_MAX_HEIGHT = 500

export function viewportSizeFor(width: number, height = Infinity): ViewportSize {
  if (width <= PHONE_MAX_WIDTH) return 'phone'
  if (width <= COMPACT_MAX_WIDTH) return height <= PHONE_MAX_HEIGHT ? 'phone' : 'compact'
  return 'wide'
}

function currentSize(): ViewportSize {
  if (typeof window === 'undefined') return 'wide'
  return viewportSizeFor(window.innerWidth, window.innerHeight)
}

/** The shell's current layout size, tracking window resizes. */
export function useViewportSize(): ViewportSize {
  const [size, setSize] = useState<ViewportSize>(currentSize)
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const queries = [
      window.matchMedia(`(max-width: ${COMPACT_MAX_WIDTH}px)`),
      window.matchMedia(`(max-width: ${PHONE_MAX_WIDTH}px)`),
      window.matchMedia(`(max-height: ${PHONE_MAX_HEIGHT}px)`)
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
