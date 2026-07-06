/**
 * reportError (main process) — make swallowed failures visible (#225).
 *
 * The renderer has its own `reportError` that can also surface to the status
 * bar; the main process has no UI, so this simply logs with a `[context]` tag
 * instead of the many `.catch(() => {})` that dropped cleanup / queue / download
 * errors on the floor. Keep it dependency-free so it's usable anywhere in main.
 */

/** Best-effort message string for any thrown value. */
export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  if (typeof err === 'string') return err
  try {
    return String(err)
  } catch {
    return 'unknown error'
  }
}

/** Log a previously-swallowed main-process error with a context tag. */
export function reportError(context: string, err: unknown): void {
  // eslint-disable-next-line no-console
  console.warn(`[${context}]`, err)
}

/** Curried reporter for fire-and-forget sites: `p.catch(reporter('fs cleanup'))`. */
export function reporter(context: string): (err: unknown) => void {
  return (err) => reportError(context, err)
}
