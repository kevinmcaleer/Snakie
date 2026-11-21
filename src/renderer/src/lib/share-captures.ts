/**
 * SHARE CAPTURES — pictures the Share sheet borrows from other workspaces.
 * =============================================================================
 *
 * The Share sheet (ShareProjectDialog) opens from the project menu on any
 * workspace, but the wiring picture is drawn by Electronics' canvas and the
 * cover picture by Build's 3D view. Each registers a capture here while it is
 * on screen; the sheet asks for one, and when it isn't there it shows that
 * workspace for a moment and waits for it (see {@link waitForShareCapture}).
 */

export type ShareCaptureKind = 'wiring' | 'cover'

/** A wiring capture gives SVG text; a cover capture gives a PNG data URL. */
type Capture = () => Promise<string | null> | string | null

const captures = new Map<ShareCaptureKind, Capture>()
const waiters = new Set<() => void>()

/** Offer a capture while mounted. Returns the function that withdraws it. */
export function registerShareCapture(kind: ShareCaptureKind, fn: Capture): () => void {
  captures.set(kind, fn)
  for (const w of [...waiters]) w()
  return () => {
    if (captures.get(kind) === fn) captures.delete(kind)
  }
}

export function hasShareCapture(kind: ShareCaptureKind): boolean {
  return captures.has(kind)
}

/** Run the capture, or null when nothing offers one (or it fails). */
export async function shareCapture(kind: ShareCaptureKind): Promise<string | null> {
  const fn = captures.get(kind)
  if (!fn) return null
  try {
    return (await fn()) ?? null
  } catch {
    return null
  }
}

/** Resolves once a capture of `kind` is offered, or false after `ms`. */
export function waitForShareCapture(kind: ShareCaptureKind, ms = 4000): Promise<boolean> {
  if (captures.has(kind)) return Promise.resolve(true)
  return new Promise((resolve) => {
    const check = (): void => {
      if (!captures.has(kind)) return
      cleanup()
      resolve(true)
    }
    const timer = setTimeout(() => {
      cleanup()
      resolve(false)
    }, ms)
    const cleanup = (): void => {
      clearTimeout(timer)
      waiters.delete(check)
    }
    waiters.add(check)
  })
}
