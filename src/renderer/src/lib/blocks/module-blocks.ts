import type { BlockArgSpec, ManifestBlock, BlocksManifest } from '../../../../shared/blocks-manifest'
import { BLOCKS_MANIFEST_VERSION } from '../../../../shared/blocks-manifest'
import type { ApiClass, ApiFunction, ApiParam, ModuleApi } from './module-api'

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
 *    parameter. `self` is already gone — the hoisted object is the receiver.
 *  - **a module function** → one call block.
 *  - **an UPPER_CASE constant** → one value block.
 *
 * WHAT IS LEFT OUT, and it is better to leave it out than to guess:
 *
 *  - **A defaulted parameter gets no socket.** `addr=0x3C` is the address the
 *    driver's author expects, and a beginner offered five sockets for a display
 *    that needs three is being asked a question they cannot answer. The default
 *    stays in the generated call by being absent from it.
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

/** One socket per parameter, in order. */
function args(params: readonly ApiParam[]): BlockArgSpec[] {
  return params.map((p) => ({ name: placeholder(p.name), kind: 'any' as const, label: p.name }))
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

/** `{WIDTH}, {HEIGHT}, {I2C}` — the call's argument list. */
function callArgs(params: readonly ApiParam[]): string {
  return socketable(params)
    .map((p) => `{${placeholder(p.name)}}`)
    .join(', ')
}

/** A human-readable "verb the object noun" message: `show the display`. */
function methodMessage(method: ApiFunction, params: readonly ApiParam[]): string {
  const holes = params.map((_, i) => `%${i + 1}`).join(' ')
  return holes ? `${method.name} ${holes}` : method.name
}

/** One class → its constructor block, then one block per method. */
function classBlocks(module: string, klass: ApiClass): ManifestBlock[] {
  const out: ManifestBlock[] = []
  const initParams = socketable(klass.init ?? [])
  if (expressible(klass.init ?? [])) {
    out.push({
      id: `new_${klass.name}`,
      message: `the ${klass.name}${initParams.map((_, i) => ` %${i + 1}`).join('')}`,
      shape: 'value',
      output: 'Object',
      args: args(initParams),
      // Hoisted, so the object is built once above the program. The key is the
      // construction itself, so two blocks naming the same object share one.
      setup: { name: klass.name.toLowerCase(), expr: `${module}.${klass.name}(${callArgs(klass.init ?? [])})` },
      code: '{SETUP}',
      imports: [{ module }],
      tooltip: `Make a ${klass.name} from ${module}, once, above your program.`
    })
  }
  for (const method of klass.methods) {
    if (!expressible(method.params)) continue
    const params = socketable(method.params)
    out.push({
      id: `${klass.name}_${method.name}`,
      // The object comes first, as a socket: the constructor block plugs in.
      message: `${methodMessage(method, params)} of %${params.length + 1}`,
      args: [...args(params), { name: 'OBJ', kind: 'any', label: 'on', shadow: `new_${klass.name}` }],
      code: `{OBJ}.${method.name}(${callArgs(method.params)})`,
      tooltip: `${klass.name}.${method.name}(${method.params.map((p) => p.name).join(', ')})`
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
    code: `${module}.${fn.name}(${callArgs(fn.params)})`,
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
