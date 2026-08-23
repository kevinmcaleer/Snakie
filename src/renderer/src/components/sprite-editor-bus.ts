/**
 * Sprite editor launch bus — the same window-event seam the Part Editor uses
 * (`OPEN_PART_EDITOR_EVENT`): any component (the Display instrument's SPRITES
 * key, or an inline sprite thumbnail in the code editor — #790) dispatches the
 * event, and the AppShell host mounts the {@link SpriteEditor} overlay in
 * response. Kept in its own tiny module so the caller doesn't import the (heavy)
 * editor component.
 */

export const OPEN_SPRITE_EDITOR_EVENT = 'snakie:open-sprite-editor'

/** The payload an inline thumbnail sends: the `.spr` to open for editing. */
export interface OpenSpriteEditorDetail {
  /** Absolute path of a `.spr` to load, or null for the parked draft. */
  path: string | null
}

/**
 * Ask the main window to open the Sprite editor overlay. With a `path` the
 * editor loads that `.spr` and saves back over it; without one it resumes the
 * parked draft, which is what the Display instrument's SPRITES key wants.
 */
export function openSpriteEditor(path: string | null = null): void {
  window.dispatchEvent(
    new CustomEvent<OpenSpriteEditorDetail>(OPEN_SPRITE_EDITOR_EVENT, { detail: { path } })
  )
}
