/**
 * INLINE SPRITE THUMBNAILS — Monaco glue for #790.
 * =============================================================================
 *
 * A `.spr` reference in an open Python file renders its sprite right beside the
 * string literal, at about line height, **always** — not on hover. Hover only
 * helps someone who already suspects there is something worth hovering, and the
 * thing MakeCode gets for free is discovery (epic #789). Clicking the chip opens
 * that sprite in the Sprite editor.
 *
 * ── How it is drawn ─────────────────────────────────────────────────────────
 * The same technique VS Code's colour swatches use: a decoration with INJECTED
 * TEXT (`before`) carrying an `inlineClassName`, plus a stylesheet rule per
 * sprite that gives that class its `background-image` (the SVG data URI from
 * `sprite-thumb.ts`) and its width. `inlineClassNameAffectsLetterSpacing` tells
 * Monaco the class changes the run's metrics, so the cursor stays where the
 * caret says it is.
 *
 * The `<style>` element is owned by this controller and rewritten wholesale on
 * every apply, so rules for sprites that are no longer referenced disappear with
 * them — no growing stylesheet, no stale image kept alive by a dangling rule.
 *
 * ── What it costs to type ───────────────────────────────────────────────────
 * A keystroke costs NOTHING here. Monaco carries the existing decorations along
 * with the edit (they are `NeverGrowsWhenTypingAtEdges`), and the repaint is
 * debounced: the buffer is re-scanned once typing pauses, not per character.
 * Even then the paint is synchronous and does NO I/O — it asks the cache what it
 * already knows (`peek`, a `Map` lookup). Only the async pass behind that
 * debounce touches the disk, and it is keyed by path + mtime, so a `.spr` is
 * read and rendered once and re-used until the file itself changes.
 *
 * ── When nothing is drawn ───────────────────────────────────────────────────
 * Only Python models, only in Electron (a browser tab has no local files to
 * resolve against), and only for references that have somewhere to resolve TO.
 * An unsaved buffer with no project folder open shows nothing, because "I cannot
 * tell" is not the same as "it is broken" — but a reference that CAN be resolved
 * and is not there shows a warning marker, never silence.
 */
import type * as Monaco from 'monaco-editor/esm/vs/editor/editor.api'
import { isElectron } from '../lib/platform'
import { findSpriteRefs, resolveSpriteRef, type SpriteRefScope } from './sprite-refs'
import { spriteSummary } from './sprite-thumb'
import { spriteThumbCache, type SpriteThumbRecord } from './sprite-thumb-cache'
import './SpriteDecorations.css'

/** Debounce before the filesystem is touched after an edit. */
const REFRESH_DEBOUNCE_MS = 300

/** Chip height, in `em` of the editor font — about one line of code. */
const CHIP_EM = 1.15
/** Width bounds so a 128×64 banner sprite can't shove the line off-screen. */
const MIN_CHIP_EM = 0.9
const MAX_CHIP_EM = 3.5

/** The injected glyph for a sprite we could draw (the image is the background). */
const CHIP_GLYPH = ' '
/** The injected glyph for a reference we could not resolve — visibly wrong. */
const BROKEN_GLYPH = '⚠'

/** Where references resolve, plus whether a miss is worth calling broken. */
export interface SpriteThumbScope extends SpriteRefScope {
  /**
   * False when the buffer's own files are NOT on this filesystem — a `main.py`
   * opened off the BOARD. Its `eyes.spr` sits in the board's flash, which the
   * local fs cannot read, so a miss there means "not here", not "missing": the
   * thumbnail still draws if the sprite also happens to be in the project
   * folder, but nothing is ever marked broken. Defaults to true.
   */
  local?: boolean
}

export interface SpriteThumbnailOptions {
  /** Where relative sprite names are resolved — read fresh on every pass. */
  getScope: () => SpriteThumbScope
  /** Open a sprite for editing (the click target). */
  onOpen: (path: string) => void
}

/** Live handle on an attached controller. */
export interface SpriteThumbnailController {
  /** Re-run now (e.g. the active file or the project folder changed). */
  refresh: () => void
  dispose: () => void
}

/**
 * Attach inline sprite thumbnails to an editor. Returns a handle; dispose it
 * BEFORE disposing the editor.
 */
export function attachSpriteThumbnails(
  monaco: typeof Monaco,
  editor: Monaco.editor.IStandaloneCodeEditor,
  options: SpriteThumbnailOptions
): SpriteThumbnailController {
  const cache = spriteThumbCache()
  const collection = editor.createDecorationsCollection([])
  const style = document.createElement('style')
  style.dataset.snakie = 'sprite-thumbnails'
  document.head.appendChild(style)

  /** CSS class → the sprite it stands for, so a click knows what to open. The
   *  `s` prefix keeps a content hash from ever colliding with `--broken`. */
  const pathByClass = new Map<string, string>()
  let timer: number | undefined
  let disposed = false

  /** Paint from what the cache already knows. Synchronous, no I/O. */
  const apply = (): string[] => {
    const model = editor.getModel()
    if (!model || model.isDisposed() || model.getLanguageId() !== 'python') {
      collection.clear()
      style.textContent = ''
      pathByClass.clear()
      return []
    }

    const scope = options.getScope()
    const decorations: Monaco.editor.IModelDeltaDecoration[] = []
    const rules = new Map<string, string>()
    const wanted: string[] = []
    pathByClass.clear()

    for (const ref of findSpriteRefs(model.getValue())) {
      const candidates = resolveSpriteRef(ref.text, scope)
      if (!candidates.length) continue // nowhere to look — say nothing
      for (const path of candidates) wanted.push(path)

      const known = candidates.map((path) => cache.peek(path))
      const hit = known.find((record) => record?.state === 'ok')
      // Still loading (some candidate has never been looked at): leave the line
      // alone rather than flashing a broken marker that resolves a tick later.
      if (!hit && known.some((record) => record === undefined)) continue
      // A board file's sprites live on the board — a local miss proves nothing.
      if (!hit && scope.local === false) continue

      const range = new monaco.Range(ref.line, ref.endColumn, ref.line, ref.endColumn)
      if (hit?.thumb) {
        const widthEm = clamp(hit.thumb.aspect * CHIP_EM, MIN_CHIP_EM, MAX_CHIP_EM)
        const chipClass = `sprthumb--s${hit.key}`
        rules.set(
          chipClass,
          `.${chipClass}{width:${widthEm.toFixed(2)}em;` +
            `background-image:url("${hit.thumb.dataUri}")}`
        )
        pathByClass.set(chipClass, hit.path)
        decorations.push({
          range,
          options: {
            stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
            before: {
              content: CHIP_GLYPH,
              inlineClassName: `sprthumb ${chipClass}`,
              inlineClassNameAffectsLetterSpacing: true
            },
            hoverMessage: { value: okHover(ref.text, hit) }
          }
        })
      } else {
        decorations.push({
          range,
          options: {
            stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
            before: {
              content: BROKEN_GLYPH,
              inlineClassName: 'sprthumb sprthumb--broken',
              inlineClassNameAffectsLetterSpacing: true
            },
            hoverMessage: { value: brokenHover(ref.text, candidates, known) }
          }
        })
      }
    }

    collection.set(decorations)
    style.textContent = [...rules.values()].join('\n')
    return wanted
  }

  /** Paint, then bring the cache up to date in the background and repaint. */
  const run = (): void => {
    // Outside Electron there are no local files to resolve against, and the
    // stubbed bridge would report every reference as broken. Draw nothing.
    if (disposed || !isElectron()) return
    const wanted = apply()
    if (!wanted.length) return
    void cache.refresh(wanted).then((changed) => {
      if (changed && !disposed) apply()
    })
  }

  const schedule = (): void => {
    window.clearTimeout(timer)
    timer = window.setTimeout(run, REFRESH_DEBOUNCE_MS)
  }

  const disposables = [
    editor.onDidChangeModelContent(schedule),
    editor.onDidChangeModel(() => run()),
    editor.onMouseDown((e: Monaco.editor.IEditorMouseEvent) => {
      const chip = e.target.element?.closest?.('.sprthumb')
      if (!chip) return
      for (const cls of Array.from(chip.classList)) {
        const path = pathByClass.get(cls)
        if (path) {
          e.event.preventDefault()
          e.event.stopPropagation()
          options.onOpen(path)
          return
        }
      }
    })
  ]
  // A sprite saved from the editor (or any explicit invalidation) repaints the
  // code immediately instead of waiting out the cache TTL.
  const unsubscribe = cache.subscribe(() => run())

  run()

  return {
    refresh: run,
    dispose: () => {
      disposed = true
      window.clearTimeout(timer)
      unsubscribe()
      for (const d of disposables) d.dispose()
      try {
        collection.clear()
      } catch {
        // The editor may already be gone; the decorations went with it.
      }
      style.remove()
    }
  }
}

const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, n))

/** Hover for a sprite we drew: what it is, where it is, and that it's clickable. */
function okHover(text: string, record: SpriteThumbRecord): string {
  const size = spriteSummary(record.width ?? 0, record.height ?? 0, record.frames ?? 0)
  const shown = (record.thumb?.frameIndex ?? 0) + 1
  const frame = (record.frames ?? 1) > 1 ? `\n\nShowing frame ${shown}.` : ''
  return `**${text}** — ${size}${frame}\n\nClick the sprite to edit it.\n\n\`${record.path}\``
}

/** Hover for a reference we could not draw: the reason, and everywhere we looked. */
function brokenHover(
  text: string,
  candidates: string[],
  known: (SpriteThumbRecord | undefined)[]
): string {
  const broken = known.find((record) => record?.state === 'error')
  const why = broken?.error ?? 'No such file.'
  const looked = candidates.map((path) => `- \`${path}\``).join('\n')
  return `**${text}** — sprite not shown.\n\n${why}\n\nLooked in:\n\n${looked}`
}
