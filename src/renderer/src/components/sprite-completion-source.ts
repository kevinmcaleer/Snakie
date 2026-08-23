/**
 * SPRITE COMPLETIONS — the wiring that keeps the popup fed (#791, epic #789).
 * =============================================================================
 *
 * Three pieces already exist and this only joins them up:
 *
 *  - `sprite-index.ts` knows WHICH `.spr` files the project has (a snapshot,
 *    refreshed off the keystroke path).
 *  - `sprite-thumb-cache.ts` — #790's path+mtime-keyed cache — already knows how
 *    big each sprite is and how many frames it has, because it decoded the file
 *    to draw the inline thumbnail. The completion detail (`12×8 · 3 frames`) is
 *    read straight out of those records; nothing here opens a `.spr`.
 *  - `micropython-completions.ts` owns the one registered provider, and takes a
 *    source through {@link setSpriteCompletionSource} exactly as it takes the
 *    board's dialect through `setCompletionDialect`.
 *
 * ── When the list is re-read ────────────────────────────────────────────────
 * Never on a keystroke. {@link SpriteCompletionsController.refresh} is called
 * when the editor's folders change (a file opened, a project folder opened),
 * and the provider's `touch()` nudges a background walk only once the snapshot
 * has outlived its TTL. On top of that:
 *
 *  - `FILE_SAVED_EVENT` for a local file marks the snapshot stale, so a `.spr`
 *    saved anywhere in the app is completable immediately afterwards.
 *  - The thumbnail cache's own change signal does the same. The sprite editor
 *    calls `invalidateSpriteThumb` after writing a `.spr`, which is the ONLY
 *    notice a brand-new sprite file gives — it is written through
 *    `fs.writeFileBytes`, not through the workspace store, so no save event
 *    fires. Listening here means "draw a sprite, save it, type its name" works
 *    on the next keystroke rather than after the TTL.
 *
 * That last hook cannot feed itself: invalidating only marks the snapshot
 * stale, and the warm pass reads sprites the cache has NO record of — so once
 * every sprite is known, its `refresh` is a no-op and emits nothing.
 */
import { FILE_SAVED_EVENT, type FileSavedDetail } from '../store/workspace'
import { spriteFileIndex } from './sprite-index'
import { spriteSearchDirs, type SpriteRefScope } from './sprite-refs'
import { setSpriteCompletionSource } from './micropython-completions'
import { spriteSummary } from './sprite-thumb'
import { spriteThumbCache } from './sprite-thumb-cache'

/** Live handle on the installed source. */
export interface SpriteCompletionsController {
  /** Re-check the project now (the active file or the project folder changed). */
  refresh: () => void
  dispose: () => void
}

/**
 * Install the sprite completion source, and keep it current. Returns a handle;
 * dispose it when the editor goes away, or the provider keeps a source pointed
 * at a scope that no longer exists.
 */
export function attachSpriteCompletions(
  getScope: () => SpriteRefScope
): SpriteCompletionsController {
  const index = spriteFileIndex()
  const cache = spriteThumbCache()
  let disposed = false

  /** Walk for `.spr` files, then read the ones we have never measured. */
  const warm = (): void => {
    if (disposed) return
    const roots = spriteSearchDirs(getScope())
    if (!roots.length) return // nowhere to look — the popup offers nothing
    void index
      .refresh(roots)
      .then(() => {
        if (disposed) return
        // Only sprites with NO record: measuring costs a stat + a decode, and
        // re-verifying the ones already known is the decoration pass's job.
        const unmeasured = index.list().filter((path) => !cache.peek(path))
        if (unmeasured.length) return cache.refresh(unmeasured)
        return undefined
      })
      .catch(() => undefined) // a missing folder is not worth a report here
  }

  setSpriteCompletionSource({
    paths: () => index.list(),
    scope: getScope,
    describe: (path) => {
      const record = cache.peek(path)
      return record?.state === 'ok'
        ? spriteSummary(record.width ?? 0, record.height ?? 0, record.frames ?? 0)
        : undefined
    },
    touch: () => {
      if (index.stale(spriteSearchDirs(getScope()))) warm()
    }
  })

  const onSaved = (event: Event): void => {
    const detail = (event as CustomEvent<FileSavedDetail>).detail
    if (detail?.source === 'local') index.invalidate()
  }
  window.addEventListener(FILE_SAVED_EVENT, onSaved)
  const unsubscribe = cache.subscribe(() => index.invalidate())

  warm()

  return {
    refresh: warm,
    dispose: () => {
      disposed = true
      unsubscribe()
      window.removeEventListener(FILE_SAVED_EVENT, onSaved)
      setSpriteCompletionSource(null)
    }
  }
}
