import { useCallback, useEffect, useRef, useState } from 'react'
import { useSync, type SyncedFile } from '../store/sync'
import './SyncIndicator.css'

/**
 * FILE-SYNC INDICATOR (#863)
 * =============================================================================
 *
 * A small sync glyph in the status bar saying that file sync is on, and — on
 * hover — the list of tagged files with a tick against each one that has
 * actually reached the board.
 *
 * The question it answers is the one the existing UI could not: the device-tree
 * toolbar glyph (#178) says *a* sync happened, and the status-bar message says
 * what the last one did, but neither survives long enough to tell you whether
 * the file you are about to run is the file that is on the board. This does,
 * standing still, for every tagged path at once.
 *
 * The glyph appears when sync is on OR when anything is tagged — never on a
 * fresh install with nothing set up, where it would be one more piece of chrome
 * meaning nothing. When files are tagged but sync-on-save is off it renders
 * dimmed, because "3 files tagged, none of them syncing on save" is exactly the
 * state that catches people out.
 */

/** Two opposing arrows. A 12px status-bar-scale sibling of the device tree's
 *  toolbar glyph; SVG rather than an emoji so it renders on a Pi (#549). */
const SyncGlyph = (): JSX.Element => (
  <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
    <g fill="currentColor">
      <path d="M2 5h9V2l4 4-4 4V7H2z" />
      <path d="M14 11H5v3l-4-4 4-4v3h9z" />
    </g>
  </svg>
)

/** The checkbox glyph for one row — same vocabulary as the transfer dialog (#848). */
export function tickFor(state: SyncedFile['state']): string {
  if (state === 'done') return '☑'
  if (state === 'error') return '☒'
  return '☐'
}

/** How the glyph itself reads. Exported so the mapping is testable on its own. */
export type SyncMode = 'on' | 'off' | 'syncing' | 'error'

/**
 * Pick the glyph's mode. A failed file outranks a running sync: the thing the
 * user needs to know is that something did not make it, and that survives the
 * next sync starting.
 */
export function syncMode(
  syncOnSave: boolean,
  files: SyncedFile[],
  status: 'idle' | 'syncing' | 'done' | 'error'
): SyncMode {
  if (!syncOnSave) return 'off'
  if (files.some((f) => f.state === 'error')) return 'error'
  return status === 'syncing' ? 'syncing' : 'on'
}

/** The one line at the top of the popup, and the button's accessible name. */
export function syncSummary(syncOnSave: boolean, files: SyncedFile[]): string {
  const total = files.length
  const plural = total === 1 ? '' : 's'
  if (!syncOnSave) return `File sync is off — ${total} file${plural} tagged`
  if (total === 0) return 'File sync is on — no files tagged yet'
  const done = files.filter((f) => f.state === 'done').length
  return `File sync is on — ${done} of ${total} on the board`
}

/** How long the popup survives the pointer leaving, so the gap between the
 *  button and the popup is crossable. */
const HOVER_GRACE_MS = 160

/** Where the popup sits: pinned to the button, in viewport coordinates. */
interface Anchor {
  right: number
  bottom: number
}

/**
 * Measure the button so the popup can be `position: fixed`.
 *
 * Fixed rather than absolute because the status bar sets `overflow: hidden` —
 * an absolutely-positioned child is clipped at the bar's 1.6rem height, which
 * is how the firmware popup ended up fixed too. Aligning the popup's right edge
 * with the button's keeps it visually attached without it being a child in the
 * layout sense.
 */
function anchorTo(el: HTMLElement | null): Anchor | null {
  if (!el) return null
  const r = el.getBoundingClientRect()
  return {
    right: Math.max(6, window.innerWidth - r.right),
    bottom: Math.max(6, window.innerHeight - r.top + 6)
  }
}

export function SyncIndicator(): JSX.Element | null {
  const { syncOnSave, status, syncedFiles } = useSync()
  const [open, setOpen] = useState(false)
  const [anchor, setAnchor] = useState<Anchor | null>(null)
  const btnRef = useRef<HTMLButtonElement | null>(null)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const show = useCallback((): void => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current)
      closeTimer.current = null
    }
    setAnchor(anchorTo(btnRef.current))
    setOpen(true)
  }, [])

  /**
   * Close on a short delay rather than immediately.
   *
   * The popup is `position: fixed` and sits a few pixels ABOVE the button, so
   * the pointer travelling from one to the other crosses a strip that belongs
   * to neither — which fires `mouseleave` and takes the popup away just as the
   * user reaches for it. The grace period covers the gap, and a wobbling hand.
   */
  const hide = useCallback((): void => {
    if (closeTimer.current) clearTimeout(closeTimer.current)
    closeTimer.current = setTimeout(() => setOpen(false), HOVER_GRACE_MS)
  }, [])

  useEffect(() => {
    return () => {
      if (closeTimer.current) clearTimeout(closeTimer.current)
    }
  }, [])

  // Escape closes it, like every other transient surface in the app. A resize
  // closes it too: the anchor was measured once and would otherwise leave the
  // popup pointing at where the button used to be.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false)
    }
    const onResize = (): void => setOpen(false)
    window.addEventListener('keydown', onKey)
    window.addEventListener('resize', onResize)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', onResize)
    }
  }, [open])

  // Nothing tagged and sync off — there is nothing to report, so report nothing.
  if (!syncOnSave && syncedFiles.length === 0) return null

  const done = syncedFiles.filter((f) => f.state === 'done').length
  const total = syncedFiles.length
  const mode = syncMode(syncOnSave, syncedFiles, status)
  const summary = syncSummary(syncOnSave, syncedFiles)

  return (
    <div
      className="syncind"
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      <button
        ref={btnRef}
        type="button"
        className={`statusbar__item syncind__btn syncind__btn--${mode}`}
        aria-expanded={open}
        aria-controls="syncind-popup"
        aria-label={summary}
        // Click toggles as well as hover, so this works by touch and by keyboard
        // and not only with a pointer that can hover.
        onClick={() => (open ? setOpen(false) : show())}
      >
        <SyncGlyph />
        {total > 0 && (
          <span className="syncind__count">
            {done}/{total}
          </span>
        )}
      </button>

      {open && (
        <div
          id="syncind-popup"
          className="syncind__popup"
          role="region"
          aria-label="Files kept in sync with the board"
          style={anchor ? { right: `${anchor.right}px`, bottom: `${anchor.bottom}px` } : undefined}
        >
          <p className="syncind__summary">{summary}</p>

          {total === 0 ? (
            <p className="syncind__empty">
              Tick a file or folder in Local files to keep it in sync.
            </p>
          ) : (
            <ul className="syncind__list">
              {syncedFiles.map((f) => (
                <li key={f.path} className={`syncind__row syncind__row--${f.state}`}>
                  <span className="syncind__tick" aria-hidden="true">
                    {tickFor(f.state)}
                  </span>
                  <span className="syncind__name" title={f.path}>
                    {f.name}
                  </span>
                  {/* The destination is only shown once a sync has established
                      it: a folder lands in the highlighted device folder and a
                      file at /<name>, and guessing before we know would point at
                      the wrong place. */}
                  {f.dest && <span className="syncind__dest">{f.dest}</span>}
                  {f.state === 'error' && f.error && (
                    <span className="syncind__err" title={f.error}>
                      {f.error}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
