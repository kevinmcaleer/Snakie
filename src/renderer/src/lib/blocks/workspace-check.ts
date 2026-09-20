import type { BlockLevel } from './registry'

/**
 * "CAN THIS BUILD READ THESE BLOCKS?" (#1009, epic #1007).
 * =============================================================================
 *
 * A blocks file can arrive carrying block types this copy of Snakie does not
 * have: it was made by a newer version, or by a part or plugin that contributes
 * blocks (#1017) and isn't installed here. Blockly's deserialiser throws on the
 * first one it doesn't recognise.
 *
 * What must NOT happen next is the thing that happened before this module
 * existed: the canvas catches the throw, clears itself, and the very next change
 * event serialises that EMPTY workspace back over the file — turning "I can't
 * show your program" into "I deleted your program", silently, on a save the user
 * didn't think twice about. That is precisely the overwrite `blocks-doc.ts`
 * refuses to do for a hand-edited file, and it would be no better here.
 *
 * So the check happens BEFORE injection: if anything in the workspace is unknown,
 * the canvas never mounts, no change listener is attached, and there is no path
 * from the screen to the file at all. The user gets a notice naming the blocks
 * and the one escape that doesn't lose anything — keep the Python, drop the
 * blocks — and doing nothing leaves the file byte-for-byte as it was.
 *
 * Pure and Blockly-free so the walk is unit-tested rather than discovered.
 */

/**
 * Every `type` in a serialised workspace, deduplicated, in first-seen order.
 *
 * Walks the JSON generically rather than following Blockly's schema: the shape
 * has `blocks.blocks[]`, `next.block`, `inputs.X.block`, `inputs.X.shadow` and
 * grows more nesting with every Blockly release, and a walker that knows the
 * schema is a walker that misses the branch added last year — which here would
 * mean failing to notice an unknown block and deleting it.
 */
export function collectBlockTypes(value: unknown, seen: Set<string> = new Set()): string[] {
  if (Array.isArray(value)) {
    for (const v of value) collectBlockTypes(v, seen)
    return [...seen]
  }
  if (!value || typeof value !== 'object') return [...seen]
  const node = value as Record<string, unknown>
  if (typeof node.type === 'string') seen.add(node.type)
  for (const v of Object.values(node)) collectBlockTypes(v, seen)
  return [...seen]
}

/**
 * The block types in `workspace` that `isKnown` doesn't recognise.
 *
 * `isKnown` is injected so this module never imports Blockly — the canvas passes
 * a lookup into `Blockly.Blocks`, and a test passes a Set.
 */
export function unknownBlockTypes(
  workspace: unknown,
  isKnown: (type: string) => boolean
): string[] {
  return collectBlockTypes(workspace).filter((t) => !isKnown(t))
}

/**
 * The block types in `workspace` a beginner is not offered in the drawer (#1212).
 *
 * The level filters the TOOLBOX, never the reader: a file full of classes and
 * comprehensions opens, renders and generates exactly the same in simple mode
 * as in advanced — nothing is downgraded to a grey `snakie_python_*` block
 * because of a setting. What such a file does earn is a one-line offer to put
 * those blocks back in the drawer, and this is the walk that answers whether
 * there is anything to offer.
 *
 * `levelOf` is injected for the same reason `isKnown` is above: this module
 * knows about neither Blockly nor the registry, so the walk stays unit-tested
 * rather than discovered.
 */
export function advancedBlockTypes(
  workspace: unknown,
  levelOf: (type: string) => BlockLevel | undefined
): string[] {
  return collectBlockTypes(workspace).filter((t) => levelOf(t) === 'advanced')
}
