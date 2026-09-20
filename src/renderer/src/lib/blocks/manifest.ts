import type * as Blockly from 'blockly/core'
import { Order } from './generator'
import type { MicroPythonGenerator } from './generator'
import type { BlockDefinition, BlockGroup } from './registry'
import type { BlockCategoryId } from './theme'
import { FIELD_PIN_TYPE } from './pin-field'
import { pyString } from './py'
import { isAtomicExpression } from './python-check'
import {
  SETUP_PLACEHOLDER,
  renderTemplate,
  type BlockArgSpec,
  type BlocksManifest,
  type ManifestBlock
} from '../../../../shared/blocks-manifest'

/**
 * THE MANIFEST LOADER (#1017, epic #1007).
 * =============================================================================
 *
 * `blocks.yml` in → registered Blockly blocks and MicroPython emitters out. This
 * is the module that makes the third-party half of the palette real: after this,
 * adding a block means writing YAML, and nothing in Electron changes ever again.
 *
 * ONE DECLARATION, THREE CONSUMERS — the same promise `registry.ts` makes for
 * hand-written blocks, kept for declared ones. A manifest entry becomes the
 * Blockly shape, the emitter and the toolbox slot together, so a part cannot
 * ship a block that appears in the flyout and generates nothing.
 *
 * NAMESPACED TYPES. Two parts may both sensibly ship a block called `read`, and
 * Blockly's definition table is global and last-write-wins — so a manifest's ids
 * are namespaced by WHERE IT CAME FROM before they are registered. That is also
 * what lets a blocks FILE survive: a saved workspace records the namespaced
 * type, so re-opening it with the part uninstalled produces the honest "these
 * blocks need a part you don't have" notice rather than a silently different
 * block wearing the same name.
 *
 * WHAT A MANIFEST CANNOT DO, and why the list is short. It cannot run code — a
 * template only ever produces a string. It cannot reach the device, the file
 * system or the network. It cannot name a Blockly field type we didn't build.
 * The strongest thing a hostile `blocks.yml` can do is write silly Python into a
 * file its own user can read before pressing Run, which is the same power the
 * keyboard already has.
 */

/** Where a set of manifest blocks came from — the namespace of its types. */
export interface BlockSource {
  /**
   * `part`, `plugin` or `module`; part of the generated type name.
   *
   * `module` (#1048) is an imported Python module read for its API — a third
   * way blocks arrive, and namespaced separately so `ssd1306`'s `show` can
   * never collide with a part's.
   */
  kind: 'part' | 'plugin' | 'module'
  /**
   * Unique within the kind: `<libraryId>.<partId>` for a part, the plugin id for
   * a plugin. Non-identifier characters are flattened, so the type stays a legal
   * Blockly type and a readable one.
   */
  id: string
  /** The human name of the part or plugin, for the toolbox sub-category. */
  name: string
  /** The toolbox category these blocks live in. */
  category: BlockCategoryId
  /**
   * The part whose driver this block's use should offer to install (#184's
   * banner). Absent for plugin blocks, which install themselves with `pip`.
   */
  part?: { libraryId: string; partId: string }
}

/** The Blockly type one manifest block registers as. */
export function blockTypeFor(source: BlockSource, id: string): string {
  return `snakie_${source.kind}_${flatten(source.id)}_${flatten(id)}`
}

/** Flatten anything into the `[a-z0-9_]` a Blockly type name should be. */
function flatten(raw: string): string {
  return String(raw)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

/**
 * A whole manifest → registrable block definitions.
 *
 * Nothing here can fail: the manifest was already validated by the shared parser
 * (every hole names an argument, every argument has a slot in the message), so
 * this is a translation rather than a second gate. Anything the parser dropped
 * never reaches here.
 */
export function blockDefinitionsFrom(
  manifest: BlocksManifest,
  source: BlockSource
): BlockDefinition[] {
  const group: BlockGroup = { id: `${source.kind}:${source.id}`, name: source.name }
  return manifest.blocks.map((block) => toDefinition(block, source, group))
}

function toDefinition(
  block: ManifestBlock,
  source: BlockSource,
  group: BlockGroup
): BlockDefinition {
  const args = block.args ?? []
  const json: Record<string, unknown> = {
    message0: block.message,
    ...(args.length > 0 ? { args0: args.map(fieldFor) } : {}),
    inputsInline: block.inline !== false,
    ...(block.shape === 'value'
      ? { output: block.output ?? null }
      : { previousStatement: null, nextStatement: null }),
    ...(block.tooltip ? { tooltip: block.tooltip } : {}),
    // An explicit colour wins over the category's, which is the one place a
    // third party gets to overrule Soft Shell — a part with a brand is entitled
    // to wear it, and the category around it still says where the block belongs.
    ...(block.colour ? { colour: block.colour } : {})
  }

  const shadows = shadowsFor(args, source)
  return {
    type: blockTypeFor(source, block.id),
    category: source.category,
    group,
    source: `${source.kind}:${source.id}`,
    ...(source.part ? { part: source.part } : {}),
    ...(block.help ? { help: block.help } : {}),
    // The manifest's own dialect scope (#1039), if it declared one.
    ...(block.scope ? { scope: block.scope } : {}),
    // …and its own simple/advanced level (#1213), which is the same word the
    // registry uses, so the toolbox filter needs no second rule for plugin and
    // part blocks: a drawer whose every block is advanced is not built at all.
    ...(block.level ? { level: block.level } : {}),
    json,
    ...(shadows ? { toolbox: { inputs: shadows } } : {}),
    imports: (block.imports ?? []).map((i) => ({
      module: i.module,
      ...(i.name ? { name: i.name } : {}),
      ...(i.alias && !i.name ? { alias: i.alias } : {})
    })),
    code: (b, gen) => emit(block, b, gen)
  }
}

/** One argument's Blockly field or input JSON. */
function fieldFor(arg: BlockArgSpec): Record<string, unknown> {
  const label = arg.label ? { label: arg.label } : {}
  switch (arg.kind) {
    case 'pin':
      return {
        type: FIELD_PIN_TYPE,
        name: arg.name,
        ...(arg.capability ? { capability: arg.capability } : {}),
        ...(arg.default === undefined ? {} : { pin: Number(arg.default) })
      }
    case 'choice':
      return {
        type: 'field_dropdown',
        name: arg.name,
        options: (arg.options ?? []).map((o) => [o.label, o.value])
      }
    case 'number-field':
      return { type: 'field_number', name: arg.name, value: Number(arg.default ?? 0) }
    case 'text-field':
      return { type: 'field_input', name: arg.name, text: String(arg.default ?? '') }
    case 'toggle':
      return { type: 'field_checkbox', name: arg.name, checked: arg.default === true }
    case 'statements':
      return { type: 'input_statement', name: arg.name, ...label }
    default:
      return {
        type: 'input_value',
        name: arg.name,
        ...(arg.kind === 'number' ? { check: 'Number' } : {}),
        ...(arg.kind === 'text' ? { check: 'String' } : {}),
        ...(arg.kind === 'boolean' ? { check: 'Boolean' } : {}),
        ...label
      }
  }
}

/**
 * The shadow blocks a dragged block arrives with.
 *
 * An empty socket is the commonest way a first block does nothing: the learner
 * drags it out, presses Run, and the generator has a hole to fill. A default
 * turns that into a working block they then EDIT, which is the Scratch
 * experience and the one this palette is copying.
 */
function shadowsFor(
  args: readonly BlockArgSpec[],
  source: BlockSource
): Record<string, unknown> | undefined {
  const inputs: Record<string, unknown> = {}
  for (const arg of args) {
    // A block shadow wins over a literal one: it is the more specific thing to
    // have asked for, and the two would otherwise both try to fill one socket.
    if (arg.shadow) {
      inputs[arg.name] = { shadow: { type: blockTypeFor(source, arg.shadow) } }
      continue
    }
    if (arg.default === undefined) continue
    if (arg.kind === 'number') {
      inputs[arg.name] = { shadow: { type: 'math_number', fields: { NUM: Number(arg.default) } } }
    } else if (arg.kind === 'text') {
      inputs[arg.name] = { shadow: { type: 'text', fields: { TEXT: String(arg.default) } } }
    } else if (arg.kind === 'boolean') {
      inputs[arg.name] = {
        shadow: { type: 'logic_boolean', fields: { BOOL: arg.default === true ? 'TRUE' : 'FALSE' } }
      }
    }
  }
  return Object.keys(inputs).length > 0 ? inputs : undefined
}

/** One block's Python. */
function emit(
  spec: ManifestBlock,
  block: Blockly.Block,
  gen: MicroPythonGenerator
): string | [string, number] {
  const values: Record<string, string> = {}
  for (const arg of spec.args ?? []) values[arg.name] = valueOf(arg, block, gen)

  if (spec.setup) {
    const expr = renderTemplate(spec.setup.expr, values)
    // The KEY is the identity of the object, so two blocks meaning the same
    // sensor share one construction. Defaulting it to the expression is the
    // right default precisely because two identical expressions ARE the same
    // object — and a manifest that wants coarser sharing says so.
    const key = spec.setup.key ? renderTemplate(spec.setup.key, values) : expr
    values[SETUP_PLACEHOLDER] = gen.setup(key, spec.setup.name ?? spec.id, expr, block)
  }

  const text = renderTemplate(spec.code, values)
  if (spec.shape === 'value') return [text, precedenceOf(text)]
  return text.endsWith('\n') ? text : `${text}\n`
}

/** One argument's value, as the Python the template gets. */
function valueOf(arg: BlockArgSpec, block: Blockly.Block, gen: MicroPythonGenerator): string {
  switch (arg.kind) {
    case 'statements': {
      // Already indented by Blockly; the trailing newline is the template's to
      // decide, since the hole sits on a line of its own.
      const body = gen.statementToCode(block, arg.name)
      return (body || `${gen.INDENT}pass\n`).replace(/\n$/, '')
    }
    case 'number':
    case 'text':
    case 'boolean':
    case 'any': {
      // NONE, so a plugged expression arrives fully parenthesised: the template
      // around it is arbitrary text and we cannot know what it binds tighter
      // than. An unplugged socket falls back to the declared default, which is
      // the same value its shadow block shows.
      const code = gen.valueToCode(block, arg.name, Order.NONE)
      if (code) return code
      if (arg.default === undefined) return arg.kind === 'boolean' ? 'False' : 'None'
      return literal(arg.kind, arg.default)
    }
    case 'toggle':
      return block.getFieldValue(arg.name) === 'TRUE' ? 'True' : 'False'
    case 'text-field':
      return pyString(String(block.getFieldValue(arg.name) ?? ''))
    case 'choice':
      // VERBATIM. A choice is usually a constant — `Pin.OUT`, `0x76`, `"fast"` —
      // and quoting it here would break every one that isn't a string.
      return String(block.getFieldValue(arg.name) ?? '')
    case 'number-field':
    case 'pin':
    default:
      return String(block.getFieldValue(arg.name) ?? arg.default ?? 0)
  }
}

function literal(kind: BlockArgSpec['kind'], value: string | number | boolean): string {
  if (kind === 'text') return pyString(String(value))
  if (kind === 'boolean') return value === true || value === 'true' ? 'True' : 'False'
  return String(value)
}

/**
 * How tightly a rendered value expression binds.
 *
 * A call, an attribute or a bare literal is atomic and reads best unwrapped —
 * `x = sensor.read()`, not `x = (sensor.read())`. Anything else might be an
 * addition or a comparison, and a template author has no way to tell us, so it
 * is treated as the loosest thing there is and parenthesised wherever the
 * context needs it. Wrong-looking parentheses are a blemish; missing ones are a
 * wrong answer.
 */
function precedenceOf(text: string): number {
  return isAtomicExpression(text) ? Order.ATOMIC : Order.NONE
}
