/**
 * OPENING A TOOL BY NAME (#917, epic #913).
 * =============================================================================
 *
 * The Tools menu's job is to make things reachable that were only reachable by
 * knowing which panel hid the button. Three of them already had window events
 * (`snakie:open-find`, `snakie:open-settings`, `snakie:open-sprite-editor`) and
 * the menu uses those directly. These two did not:
 *
 *   flasher       lives in the status bar, opened by a button there
 *   boardFinder   lived INSIDE the flash dialog and nowhere else
 *
 * They get an event each rather than the menu reaching into `StatusBar`, which
 * keeps the rule the whole channel is built on: a menu item is an id, a handler
 * and — where the action already has an owner — a message to that owner.
 */

/** A tool the status bar owns. */
export type StatusBarTool = 'flasher' | 'boardFinder'

export const OPEN_TOOL_EVENT = 'snakie:open-tool'

export interface OpenToolDetail {
  tool: StatusBarTool
}

/** Open one of the status bar's tools. */
export function dispatchOpenTool(tool: StatusBarTool): void {
  window.dispatchEvent(new CustomEvent<OpenToolDetail>(OPEN_TOOL_EVENT, { detail: { tool } }))
}

/** Listen for one tool being asked for. Returns the unsubscribe. */
export function onOpenTool(tool: StatusBarTool, open: () => void): () => void {
  const handler = (e: Event): void => {
    if ((e as CustomEvent<OpenToolDetail>).detail?.tool === tool) open()
  }
  window.addEventListener(OPEN_TOOL_EVENT, handler)
  return () => window.removeEventListener(OPEN_TOOL_EVENT, handler)
}
