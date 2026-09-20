import * as Blockly from 'blockly/core'
import { blockDefinition, DEFAULT_BLOCK_LEVEL, type BlockLevel } from './registry'
import { BLOCK_CATEGORIES } from './theme'
import { pythonForBlock } from './generator'
import type { Dialect } from '../../../../shared/dialect'

/**
 * WHAT BLOCK IS THIS? (#1245)
 * =============================================================================
 *
 * A learner opens somebody else's program — a worked example, a classmate's
 * file, a `.py` the converter turned into blocks — and meets a block they have
 * never dragged out themselves. Nothing on the canvas answers the first
 * question they have, which is not "what does this program do" but *"what is
 * THIS?"*. The shelf can't answer it either: a block already on the canvas may
 * come from a part that is wired up, a plugin, an imported module, or a drawer
 * three categories from the one they were looking in.
 *
 * Everything needed to answer is already written down — it is just written down
 * for the machine. The registry knows a block's category, the library it
 * imports, the pin it claims, the instrument it belongs to, the help article
 * that explains it and the Python call it reads back from; Blockly knows its
 * shape, its fields and what is plugged into it. This module is the one place
 * that turns all of that into a DESCRIPTION OF ONE BLOCK, and it is pure — an
 * explanation is data, so the drop target that shows it (`block-doctor.ts`) has
 * no facts of its own and the facts can be tested without a canvas.
 *
 * IT NEVER GUESSES. A block this build does not recognise says exactly that
 * rather than inventing a plausible category: a wrong answer to "what is this?"
 * is worse than no answer, because the learner has no way to check it.
 */

/** Where a block came from — the question "whose block is this?". */
export type BlockOriginKind = 'core' | 'blockly' | 'part' | 'plugin' | 'module' | 'unknown'

export interface BlockOrigin {
  kind: BlockOriginKind
  /** One line naming the source: "Snakie's built-in palette", "VL53L0X", … */
  label: string
  /** The part whose driver this block needs, when it has one. */
  part?: { libraryId: string; partId: string }
}

/** A field on the block — a dropdown, a number, a name the learner typed. */
export interface BlockFieldFact {
  /** The field's name in the definition, e.g. `PIN`. */
  name: string
  /** What it reads on screen right now. */
  value: string
}

/** A socket on the block, and whether anything is in it. */
export interface BlockSocketFact {
  name: string
  kind: 'value' | 'statement'
  filled: boolean
  /** The block plugged in, described the way the canvas reads it. */
  holds: string | null
}

/** The four silhouettes a block can have, which is what its shape TELLS you. */
export type BlockShape = 'value' | 'statement' | 'hat' | 'standalone'

export interface BlockExplanation {
  /** The Blockly type id — the one string that identifies the block exactly. */
  type: string
  /** The block read out as a sentence, e.g. `wait 1 seconds`. */
  title: string
  shape: BlockShape
  /** What that shape means, in a learner's words. */
  shapeLabel: string
  /** The toolbox category it lives in, or null when nothing claims it. */
  category: { id: string; name: string } | null
  origin: BlockOrigin
  /** Its own description — Blockly's tooltip — when it carries one. */
  description: string | null
  /** The Python modules it imports whenever it runs, e.g. `time`, `machine`. */
  libraries: readonly string[]
  /** The call it stands for, e.g. `time.sleep(seconds)`. */
  call: string | null
  fields: readonly BlockFieldFact[]
  sockets: readonly BlockSocketFact[]
  /** It claims a pin: which field holds it, what it does with it. */
  pin: { field: string; role: string; needs?: string; direction?: 'in' | 'out' } | null
  /** The instrument it draws into (`turtle`, …). */
  instrument: string | null
  /** The in-app help article that explains it, for a "Read more" link. */
  help: string | null
  level: BlockLevel
  /** Which runtimes it is true for — `both` unless the definition narrows it. */
  runtimes: 'both' | 'micropython' | 'circuitpython'
  /** The Python this very block writes, as it stands. */
  python: string | null
  /**
   * NOTHING IN THIS BUILD DESCRIBES THE TYPE.
   *
   * A block can still be on the canvas — Blockly may know how to draw it, and a
   * file carrying it opens — while the registry has no entry for it: a block
   * from a part that is not installed, from a plugin that is gone, from a newer
   * Snakie. Everything above is then whatever could still be read off the block
   * itself, and the panel says so rather than describing a block it cannot see.
   */
  unknown: boolean
}

const SHAPE_LABELS: Record<BlockShape, string> = {
  value: 'A value block — it goes in a socket and stands for a number, a word, or a reading.',
  statement: 'A statement block — it stacks with the blocks above and below it, and does something.',
  hat: 'A starting block — nothing stacks above it; the blocks under it are what it runs.',
  standalone: 'A block that stands on its own — nothing connects to it.'
}

/**
 * Everything this build knows about one block on the canvas.
 *
 * `python` costs a generator pass, so it is only run for the block in hand —
 * and a block whose emitter throws (a `return` outside a function, say) reports
 * no Python rather than taking the explanation down with it.
 */
export function explainBlock(block: Blockly.Block, dialect: Dialect = 'micropython'): BlockExplanation {
  const def = blockDefinition(block.type)
  const shape = shapeOf(block)
  const category = def ? (BLOCK_CATEGORIES.find((c) => c.id === def.category) ?? null) : null
  return {
    type: block.type,
    title: titleOf(block),
    shape,
    shapeLabel: SHAPE_LABELS[shape],
    category: category ? { id: category.id, name: category.name } : null,
    origin: originOf(block),
    description: tooltipOf(block),
    libraries: librariesOf(block),
    call: callOf(block),
    fields: fieldsOf(block),
    sockets: socketsOf(block),
    pin: def?.pin ? { ...def.pin } : null,
    instrument: def?.instrument ?? null,
    help: def?.help ?? null,
    level: def?.level ?? DEFAULT_BLOCK_LEVEL,
    runtimes: def?.scope ?? 'both',
    python: pythonOf(block, dialect),
    unknown: !def
  }
}

/** The block read out as one line, with its fields in it. */
function titleOf(block: Blockly.Block): string {
  // Blockly's own reading, which is what a screen reader says and therefore the
  // one wording already written for being spoken aloud. It truncates by default
  // at a length that cuts most hardware blocks in half, so the limit is raised
  // rather than the reading replaced.
  const text = block.toString(120)
  return text.trim() === '' ? block.type : text
}

function shapeOf(block: Blockly.Block): BlockShape {
  if (block.outputConnection) return 'value'
  if (block.previousConnection) return 'statement'
  if (block.nextConnection) return 'hat'
  return 'standalone'
}

/** The block's own tooltip, whether it is a string or computed. */
function tooltipOf(block: Blockly.Block): string | null {
  const tip: unknown = (block as { tooltip?: unknown }).tooltip
  const text = typeof tip === 'function' ? (tip as () => unknown)() : tip
  return typeof text === 'string' && text.trim() !== '' ? text.trim() : null
}

/**
 * Whose block is this?
 *
 * The registry's `source` is the answer for everything a part, a plugin or a
 * module registered (`manifest.ts` writes `part:<library>.<part>` and friends),
 * and `group.name` is the human name that drawer wears in the toolbox — so the
 * panel says "VL53L0X" rather than `part:snakie_standard_vl53l0x`.
 */
function originOf(block: Blockly.Block): BlockOrigin {
  const def = blockDefinition(block.type)
  if (!def) {
    return isKnownToBlockly(block.type)
      ? { kind: 'blockly', label: 'A Blockly block Snakie has no description for' }
      : { kind: 'unknown', label: 'Unknown to this version of Snakie' }
  }
  const name = def.group?.name
  const part = def.part ? { ...def.part } : undefined
  const kind = def.source?.split(':')[0]
  if (kind === 'part') {
    return { kind: 'part', label: `${name ?? 'A part'} — a part in your Parts library`, ...(part ? { part } : {}) }
  }
  if (kind === 'plugin') {
    return { kind: 'plugin', label: `${name ?? 'A plugin'} — a Python plugin you have installed` }
  }
  if (kind === 'module') {
    return { kind: 'module', label: `${name ?? 'A module'} — a Python module this program imports` }
  }
  return {
    kind: 'core',
    label: "Snakie's built-in palette",
    ...(part ? { part } : {})
  }
}

/** Does Blockly have a definition for this type, even though the registry doesn't? */
function isKnownToBlockly(type: string): boolean {
  return Object.prototype.hasOwnProperty.call(Blockly.Blocks, type)
}

/**
 * The libraries the block brings in with it, deduplicated and in order.
 *
 * Both halves count: the imports its emitter declares (`time`, `machine`) and
 * the module its reader names, which is the same fact seen from the other end
 * and is present on blocks whose imports are conditional.
 */
function librariesOf(block: Blockly.Block): string[] {
  const def = blockDefinition(block.type)
  if (!def) return []
  const out: string[] = []
  for (const imp of def.imports ?? []) if (!out.includes(imp.module)) out.push(imp.module)
  const read = def.read?.module
  if (read && !out.includes(read)) out.push(read)
  return out
}

/** The Python call the block stands for, from the reader's own description. */
function callOf(block: Blockly.Block): string | null {
  const read = blockDefinition(block.type)?.read
  if (!read) return null
  const receiver = read.module ? `${read.module}.` : read.on || read.receiver ? '<object>.' : ''
  return `${receiver}${read.fn}(${read.args.join(', ')})`
}

function fieldsOf(block: Blockly.Block): BlockFieldFact[] {
  const out: BlockFieldFact[] = []
  for (const input of block.inputList) {
    for (const field of input.fieldRow) {
      // Labels are the block's own wording, already in the title above; only
      // the fields a learner can CHANGE say anything about this block's setup.
      const name = field.name
      if (!name || !field.EDITABLE) continue
      out.push({ name, value: field.getText() })
    }
  }
  return out
}

function socketsOf(block: Blockly.Block): BlockSocketFact[] {
  const out: BlockSocketFact[] = []
  for (const input of block.inputList) {
    const kind =
      input.type === Blockly.inputs.inputTypes.VALUE
        ? 'value'
        : input.type === Blockly.inputs.inputTypes.STATEMENT
          ? 'statement'
          : null
    if (!kind || !input.name) continue
    const held = input.connection?.targetBlock() ?? null
    out.push({
      name: input.name,
      kind,
      filled: held !== null,
      holds: held ? titleOf(held) : null
    })
  }
  return out
}

/**
 * The Python this block writes where it stands, or null.
 *
 * THIS BLOCK ONLY — not the stack under it, which would answer a different
 * question at some length. A block whose emitter throws (or that has none)
 * reports nothing: the rest of the explanation is still true and still worth
 * showing, and "no Python" is an honest answer for a block that is not in a
 * position to generate any.
 */
function pythonOf(block: Blockly.Block, dialect: Dialect): string | null {
  try {
    const code = pythonForBlock(block, dialect).trim()
    return code === '' ? null : code
  } catch {
    return null
  }
}
