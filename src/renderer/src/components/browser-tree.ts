/**
 * Project-browser hierarchy for the Board View (#649) — pure, DOM-free.
 *
 * The browser used to be a flat list, which hid the most useful structural fact
 * on the canvas: that one board is **docked into** another. A XIAO seated in a
 * XIAO Expansion Base is physically part of it — so it belongs *under* it in the
 * tree, indented, not as a sibling three rows away.
 *
 * Seating is recorded two ways, and both are handled here: a placed part carries
 * `mountedOn` (its carrier's instance id), and the microcontroller carries
 * `RobotDefinition.boardMountedOn`. So the MCU itself can be a child of a part.
 *
 * Kept separate from `WiringCanvas` so the flattening rules — orphans, cycles,
 * ordering — are unit-testable without a canvas.
 */

import type { RobotPart } from '../../../shared/robot'

/** The key the microcontroller row uses (matches the canvas subject key). */
export const BOARD_KEY = 'board'

/** One row of the browser's component tree. */
export interface BrowserNode {
  /** Selection / focus key: {@link BOARD_KEY} for the MCU, else the part id. */
  key: string
  /** Display label. */
  label: string
  /** True for the microcontroller row (it gets the MCU tag, and no delete). */
  isBoard: boolean
  /** Parts docked INTO this one, nested and indented. */
  children: BrowserNode[]
}

/** The label a placed part shows: its own label, else the library part id. */
function partLabel(p: RobotPart): string {
  return p.label || p.part
}

/**
 * Build the browser's component tree from the robot definition.
 *
 * Rows keep their source order (the board first, then parts as placed), with
 * every docked part moved under its carrier. Deliberately total — nothing is ever
 * dropped:
 *
 * - a part whose `mountedOn` names something **not present** stays at the top
 *   level rather than vanishing (a dangling reference must not hide the part);
 * - a **cycle** (A docked into B, B docked into A) leaves both at the top level
 *   instead of recursing forever.
 */
export function browserTree(args: {
  /** The microcontroller's display name, or undefined when none is chosen. */
  board?: string
  /** The part instance the MCU is seated in (`RobotDefinition.boardMountedOn`). */
  boardMountedOn?: string
  parts: RobotPart[]
}): BrowserNode[] {
  const { board, boardMountedOn, parts } = args
  const nodes = new Map<string, BrowserNode>()
  const order: string[] = []

  if (board) {
    nodes.set(BOARD_KEY, { key: BOARD_KEY, label: board, isBoard: true, children: [] })
    order.push(BOARD_KEY)
  }
  for (const p of parts) {
    // A duplicate id would otherwise let one row overwrite another; keep the first.
    if (nodes.has(p.id)) continue
    nodes.set(p.id, { key: p.id, label: partLabel(p), isBoard: false, children: [] })
    order.push(p.id)
  }

  // Resolve each row's parent, ignoring references that don't resolve or point at
  // the row itself.
  const parentOf = new Map<string, string>()
  const link = (child: string, parent: string | undefined): void => {
    if (!parent || parent === child || !nodes.has(parent)) return
    parentOf.set(child, parent)
  }
  if (board) link(BOARD_KEY, boardMountedOn)
  for (const p of parts) link(p.id, p.mountedOn)

  /** Does following `key`'s parents lead back to `key`? */
  const inCycle = (key: string): boolean => {
    const seen = new Set<string>([key])
    let at = parentOf.get(key)
    while (at !== undefined) {
      if (at === key) return true
      if (seen.has(at)) return false // a loop that doesn't include `key`
      seen.add(at)
      at = parentOf.get(at)
    }
    return false
  }

  const roots: BrowserNode[] = []
  for (const key of order) {
    const node = nodes.get(key)!
    const parent = parentOf.get(key)
    if (parent === undefined || inCycle(key)) roots.push(node)
    else nodes.get(parent)!.children.push(node)
  }
  return roots
}

/** Total rows in a tree, at any depth — the browser's "Components" count. */
export function countNodes(nodes: BrowserNode[]): number {
  let n = 0
  for (const node of nodes) n += 1 + countNodes(node.children)
  return n
}
