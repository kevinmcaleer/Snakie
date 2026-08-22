/**
 * Sprite editor launch bus — the same window-event seam the Part Editor uses
 * (`OPEN_PART_EDITOR_EVENT`): any component (today the Display instrument's
 * SPRITES key) dispatches the event, and the AppShell host mounts the
 * {@link SpriteEditor} overlay in response. Kept in its own tiny module so the
 * instrument doesn't import the (heavy) editor component.
 */

export const OPEN_SPRITE_EDITOR_EVENT = 'snakie:open-sprite-editor'

/** Ask the main window to open the Sprite editor overlay. */
export function openSpriteEditor(): void {
  window.dispatchEvent(new CustomEvent(OPEN_SPRITE_EDITOR_EVENT))
}
