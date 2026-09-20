import type { BlockArgSpec, ManifestBlock, BlocksManifest } from '../../../../shared/blocks-manifest'
import { BLOCKS_MANIFEST_VERSION } from '../../../../shared/blocks-manifest'
import type { ApiClass, ApiFunction, ApiParam, ModuleApi } from './module-api'
import type { CallRule } from './python-to-blocks'

/**
 * A MODULE'S API, AS BLOCKS (#1048, epic #1007).
 * =============================================================================
 *
 * `module-api.ts` says what is in a module; this turns that into the
 * `ManifestBlock`s #1017 already knows how to register. Nothing new is invented:
 * the same `blockDefinitionsFrom` → `defineDynamicBlocks` path a part's
 * `blocks.yml` goes down, which is why this is a mapping and not a subsystem.
 *
 * THE SHAPES, and why each one:
 *
 *  - **a class** → one constructor block, with a `setup` hoist so the object is
 *    built once above the program rather than every time it is used. That is
 *    the same rule the hardware palette follows, and for the same reason: a
 *    display re-initialised inside a loop is a display that flickers.
 *  - **a method** → one call block per public method, with a real socket per
 *    parameter. `self` is already gone — the hoisted object is the receiver. A
 *    method that RETURNS something is a value block, so `ping.distance()` fits
 *    inside a `print`; one that only does things stacks as a statement.
 *  - **a property** → one value block, `distance of (the RangeFinder)`, that
 *    writes `obj.distance` with no brackets — a `@property` or a `self.x = …`.
 *  - **a module function** → one call block.
 *  - **an UPPER_CASE constant** → one value block.
 *
 * DEFAULTED PARAMETERS. On a METHOD they get no socket: `col=1` is the colour
 * the driver's author expects, and a beginner offered five sockets for a call
 * that needs three is being asked a question they cannot answer. On the
 * CONSTRUCTOR they are different — `RangeFinder(echo_pin=0, trigger_pin=1)` puts
 * the WIRING in its defaults, and a block with no way to say which pins the
 * sensor is on is a block for somebody else's breadboard. So a constructor
 * default that is a plain number, string or `True`/`False` becomes a socket
 * pre-filled with that default, and is written back as the keyword argument
 * the author named — the mirror teaches the parameter's name as it goes. A
 * default this cannot show as a shadow (`0x3C`, `None`, `Pin.OUT`) stays out of
 * the block and in the call by omission, exactly as before.
 *
 * WHAT IS LEFT OUT, and it is better to leave it out than to guess:
 *
 *  - **`*args`/`**kwargs` cannot become sockets at all**, so a method with one
 *    is skipped and #1018's call block remains the way to reach it.
 *  - **Types are unknowable**, so every socket is `any`. These blocks are more
 *    permissive than a hand-written `blocks.yml`, which is exactly why #1017's
 *    manifest stays the good path and this is the floor under it.
 */

/** The sub-drawer a module's blocks live in, and the id its blocks share. */
export function moduleGroupId(module: string): string {
  return `module:${module}`
}

/** A parameter that can be a socket: named, not variadic, not defaulted. */
function socketable(params: readonly ApiParam[]): ApiParam[] {
  return params.filter((p) => !p.variadic && p.default === undefined)
}

/** Can this whole signature be expressed as sockets? */
function expressible(params: readonly ApiParam[]): boolean {
  return params.every((p) => !p.variadic)
}

/**
 * The shadow a default can be shown as, or null for one it cannot.
 *
 * A plain number, a quoted string with nothing escaped in it, and the two
 * booleans — the three literal kinds a manifest shadow can hold. Anything
 * else (`0x3C`, `None`, a name) has no block that shows it as written.
 */
export function shadowFor(
  text: string
): { kind: 'number' | 'text' | 'boolean'; default: number | string | boolean } | null {
  if (/^-?\d+(\.\d+)?$/.test(text)) return { kind: 'number', default: Number(text) }
  if (text === 'True' || text === 'False') return { kind: 'boolean', default: text === 'True' }
  const str = /^(['"])((?:(?!\1)[^\\])*)\1$/.exec(text)
  if (str) return { kind: 'text', default: str[2] }
  return null
}

/** A constructor parameter that can be a socket: required, or shadowable. */
function constructorSockets(params: readonly ApiParam[]): ApiParam[] {
  return params.filter(
    (p) => !p.variadic && (p.default === undefined || shadowFor(p.default) !== null)
  )
}

/** One socket per parameter, in order; a defaulted one arrives pre-filled. */
function args(params: readonly ApiParam[]): BlockArgSpec[] {
  return params.map((p) => {
    const shadow = p.default === undefined ? null : shadowFor(p.default)
    return shadow
      ? { name: placeholder(p.name), kind: shadow.kind, default: shadow.default, label: p.name }
      : { name: placeholder(p.name), kind: 'any' as const, label: p.name }
  })
}

/**
 * The template placeholder for a parameter.
 *
 * UPPER-CASED because that is the manifest's own convention (`{ANGLE}`), and
 * de-duplicated against Python's own casing: a parameter called `X` and one
 * called `x` cannot both be `{X}`, so the rare collision keeps its index.
 */
function placeholder(name: string): string {
  return name.toUpperCase()
}

/**
 * `{WIDTH}, {HEIGHT}, echo_pin={ECHO_PIN}` — the call's argument list.
 *
 * Required parameters positionally; a defaulted one that earned a socket as the
 * keyword its author named, which is both what the learner's own line says and
 * the only order-independent way to write it.
 */
function callArgs(params: readonly ApiParam[], sockets: readonly ApiParam[]): string {
  return params
    .filter((p) => sockets.includes(p))
    .map((p) => (p.default === undefined ? `{${placeholder(p.name)}}` : `${p.name}={${placeholder(p.name)}}`))
    .join(', ')
}

/** A human-readable "verb the object noun" message: `show the display`. */
function methodMessage(method: ApiFunction, params: readonly ApiParam[]): string {
  const holes = params.map((_, i) => `%${i + 1}`).join(' ')
  return holes ? `${method.name} ${holes}` : method.name
}

/** One class → its constructor block, a block per method, a block per property. */
function classBlocks(module: string, klass: ApiClass): ManifestBlock[] {
  const out: ManifestBlock[] = []
  const init = klass.init ?? []
  const initParams = constructorSockets(init)
  if (expressible(init)) {
    out.push({
      id: `new_${klass.name}`,
      message: `the ${klass.name}${initParams.map((_, i) => ` %${i + 1}`).join('')}`,
      shape: 'value',
      output: 'Object',
      args: args(initParams),
      // Hoisted, so the object is built once above the program. The key is the
      // construction itself, so two blocks naming the same object share one.
      setup: {
        name: klass.name.toLowerCase(),
        expr: `${module}.${klass.name}(${callArgs(init, initParams)})`
      },
      code: '{SETUP}',
      imports: [{ module }],
      tooltip: `Make a ${klass.name} from ${module}, once, above your program.`
    })
  }
  const obj: BlockArgSpec = { name: 'OBJ', kind: 'any', label: 'on', shadow: `new_${klass.name}` }
  for (const method of klass.methods) {
    if (!expressible(method.params)) continue
    const params = socketable(method.params)
    out.push({
      id: `${klass.name}_${method.name}`,
      // The object comes first, as a socket: the constructor block plugs in.
      message: `${methodMessage(method, params)} of %${params.length + 1}`,
      args: [...args(params), obj],
      ...(method.returns ? { shape: 'value' as const } : {}),
      code: `{OBJ}.${method.name}(${callArgs(method.params, params)})`,
      tooltip: `${klass.name}.${method.name}(${method.params.map((p) => p.name).join(', ')})`
    })
  }
  for (const name of klass.properties) {
    out.push({
      id: `${klass.name}_${name}`,
      message: `${name} of %1`,
      shape: 'value',
      args: [obj],
      code: `{OBJ}.${name}`,
      tooltip: `${klass.name}.${name} — read straight off the object, no brackets.`
    })
  }
  return out
}

/** One module-level function → one call block. */
function functionBlock(module: string, fn: ApiFunction): ManifestBlock | null {
  if (!expressible(fn.params)) return null
  const params = socketable(fn.params)
  return {
    id: `fn_${fn.name}`,
    message: methodMessage(fn, params),
    args: args(params),
    ...(fn.returns ? { shape: 'value' as const } : {}),
    code: `${module}.${fn.name}(${callArgs(fn.params, params)})`,
    imports: [{ module }],
    tooltip: `${module}.${fn.name}(${fn.params.map((p) => p.name).join(', ')})`
  }
}

/**
 * A module's API → a manifest, ready for `blockDefinitionsFrom`.
 *
 * Empty in, empty out — a module nothing could be read from contributes no
 * blocks and no drawer, which is the honest outcome and the one `pruneDynamicBlocks`
 * already handles.
 */
export function manifestForModule(api: ModuleApi): BlocksManifest {
  const blocks: ManifestBlock[] = []
  for (const klass of api.classes) blocks.push(...classBlocks(api.module, klass))
  for (const fn of api.functions) {
    const block = functionBlock(api.module, fn)
    if (block) blocks.push(block)
  }
  for (const name of api.constants) {
    blocks.push({
      id: `const_${name}`,
      message: `${api.module}.${name}`,
      shape: 'value',
      code: `${api.module}.${name}`,
      imports: [{ module: api.module }],
      tooltip: `The ${name} constant from ${api.module}.`
    })
  }
  return { version: BLOCKS_MANIFEST_VERSION, blocks }
}

/**
 * HOW A MODULE'S CALLS READ BACK (#1048, the other half).
 *
 * The blocks above write `ping.distance()` and `range_finder.helper(a)`; this
 * says what those lines look like coming the other way, so a program that uses
 * the module opens as module blocks rather than as the generic call block.
 *
 *  - A METHOD is an `on` rule — a call on WHATEVER the learner named the object,
 *    which is `xs.append(v)`'s own shape. The receiver goes in `OBJ`.
 *  - A MODULE FUNCTION is a `module.fn` rule, `time.sleep`'s shape.
 *
 * Only a signature with NO defaults reads back: the reader matches arguments by
 * position, and `col=1` written as a keyword is not a position. Such a line
 * stays with the generic call block, which regenerates it verbatim.
 *
 * `typeFor` is the namespacing `blockTypeFor` applies, handed in so this file
 * does not have to know how a source becomes a type.
 */
export function readRulesForModule(api: ModuleApi, typeFor: (id: string) => string): CallRule[] {
  const rules: CallRule[] = []
  const positional = (params: readonly ApiParam[]): readonly string[] | null =>
    expressible(params) && params.every((p) => p.default === undefined)
      ? params.map((p) => placeholder(p.name))
      : null
  for (const klass of api.classes) {
    for (const method of klass.methods) {
      const sockets = positional(method.params)
      if (!sockets) continue
      rules.push({
        fn: method.name,
        type: typeFor(`${klass.name}_${method.name}`),
        on: 'OBJ',
        args: sockets,
        shape: method.returns ? 'value' : 'statement'
      })
    }
  }
  for (const fn of api.functions) {
    const sockets = positional(fn.params)
    if (!sockets) continue
    rules.push({
      module: api.module,
      fn: fn.name,
      type: typeFor(`fn_${fn.name}`),
      args: sockets,
      shape: fn.returns ? 'value' : 'statement'
    })
  }
  return rules
}
