/**
 * WHERE THE LIVE BLOCKLY WORKSPACE LIVES (#1112).
 *
 * `BlocksCanvas` holds its workspace in a component-local ref, which is right
 * for the canvas and useless for anything else: the PDF export has to walk the
 * learner's stacks, and nothing outside that component could reach them.
 *
 * So the canvas REGISTERS its workspace here on mount and unregisters on
 * unmount, and the exporter asks for a workspace rather than going hunting for
 * an injected `<svg>` in the DOM. A deliberate seam, in one small module, with
 * no React in it — the alternative is every future feature digging through the
 * document and breaking the next time Blockly changes its markup.
 */

import type * as Blockly from 'blockly/core'

let current: Blockly.WorkspaceSvg | null = null
const listeners = new Set<(ws: Blockly.WorkspaceSvg | null) => void>()

function publish(): void {
  for (const listener of [...listeners]) listener(current)
}

/**
 * Publish `ws` as the workspace on screen. Returns the undo: call it from the
 * canvas's cleanup so a disposed workspace never stays registered — reading one
 * of those is a crash, not a stale answer.
 */
export function registerBlocksWorkspace(ws: Blockly.WorkspaceSvg): () => void {
  current = ws
  publish()
  return () => {
    // Only clear if we are still the current one: a remount can register the
    // new workspace BEFORE the old one's cleanup runs.
    if (current !== ws) return
    current = null
    publish()
  }
}

/** The workspace on screen, or null when the Blocks view isn't mounted. */
export function getBlocksWorkspace(): Blockly.WorkspaceSvg | null {
  return current
}

/** Watch for the workspace appearing and disappearing. Returns the unsubscribe. */
export function subscribeBlocksWorkspace(
  listener: (ws: Blockly.WorkspaceSvg | null) => void
): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Test seam: forget everything. */
export function resetBlocksWorkspaceRegistry(): void {
  current = null
  listeners.clear()
}
