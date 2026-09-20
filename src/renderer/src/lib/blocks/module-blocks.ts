import type { BlockArgSpec, ManifestBlock, BlocksManifest } from '../../../../shared/blocks-manifest'
import { BLOCKS_MANIFEST_VERSION } from '../../../../shared/blocks-manifest'
import type { ApiClass, ApiFunction, ApiParam, ModuleApi } from './module-api'
import type { CallRule, ConstructRule, MemberRule } from './python-to-blocks'

/**
 * A MODULE'S API, AS BLOCKS (#1048, epic #1007).
 * =============================================================================
 *
 * `module-api.ts` says what is in a module; this turns that into the
 * `ManifestBlock`s #1017 already knows how to register. Nothing new is invented:
 * the same `blockDefinitionsFrom` → `defineDynamicBlocks` path a part's
 * `blocks.yml` goes down, which is why this is a mapping and not a subsystem.
 *
 * AN OBJECT IS A VARIABLE (#1209). The first cut of this file hoisted the
 * object instead: the constructor was a VALUE block, `the RangeFinder (0) (1)`,
 * and it plugged into the receiver socket of every method and property block.
 * That generated correct Python — one hoisted `rangefinder = …` above the
 * program, however many blocks named it — and taught the wrong thing, because
 * the learner saw the wiring repeated on every single call:
 *
 *     print(f"{ (distance of (the RangeFinder (0) (1))) }")
 *
 * Nobody writes that. What they write is the two lines the issue opened with —
 * make the object once, give it a name, then use the name:
 *
 *     ping = RangeFinder(echo_pin=0, trigger_pin=1)
 *     ping.distance()
 *
 * So the constructor is a STATEMENT that assigns to a `variable` field, and
 * everything else on the class takes that same field. The pins are typed once,
 * on the line that makes the object, and every other block is a pair of
 * dropdowns: which object, and which part of it.
 *
 * THE SHAPES, and why each one:
 *
 *  - **a class** → one `make [ping] a RangeFinder` statement, which writes
 *    `ping = RangeFinder(...)` and brings `from range_finder import RangeFinder`
 *    with it. The wiring lives in its sockets.
 *  - **its readable members** → ONE value block, `[ping] 's [distance() ▾]`,
 *    whose dropdown lists every `@property`, every `__init__` attribute and
 *    every method that takes nothing and returns something. One block for the
 *    whole read surface of the class, rather than one shelf entry per member:
 *    the dropdown is also where a learner DISCOVERS what a sensor can tell
 *    them, and it teaches the brackets by showing `distance()` beside `unit`.
 *  - **its settable members** → one `set [ping] 's [unit ▾] to ( )` statement,
 *    offering only what may actually be assigned: an `__init__` attribute or a
 *    `@property` with a `.setter`. Writing to a getter-only property raises.
 *  - **a method that takes arguments, or returns nothing** → one call block
 *    each, with a real socket per parameter and the object in its variable
 *    field. A dropdown cannot grow sockets, which is why these stay separate.
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

/**
 * `RangeFinder` → `range_finder`; `SSD1306_I2C` → `ssd1306_i2c`.
 *
 * The name the block arrives holding, so a learner who drags the constructor
 * out and presses Run has a working line before they have named anything. It
 * is the class's own name in the casing Python gives an object, which is what
 * the module's README will have called it too.
 *
 * SAFE AGAINST THE IMPORT, which is the one collision that would matter: the
 * constructor writes `from range_finder import RangeFinder`, and a `from`
 * import binds only `RangeFinder` — so `range_finder` is still a free name.
 *
 * A NAME THAT ALREADY HAS AN UNDERSCORE IN IT IS ONLY LOWER-CASED. `SSD1306_I2C`
 * is the author's own word-breaking, and splitting inside it on a case change
 * gives `ssd1306_i2_c` — an acronym cut in half.
 */
export function objectNameFor(klass: string): string {
  if (klass.includes('_')) return klass.toLowerCase()
  return klass
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .toLowerCase()
}

/** The object every block on a class names: one variable, one dropdown. */
function objectArg(klass: ApiClass): BlockArgSpec {
  return { name: 'OBJ', kind: 'variable', default: objectNameFor(klass.name) }
}

/**
 * A method the member dropdown can cover: it takes nothing and gives back
 * something, so it reads exactly like a property with brackets on it.
 *
 * `ping.distance()` is this, and it is the single commonest thing anybody does
 * with a sensor. A method with parameters cannot be here — a dropdown has
 * nowhere to put them — and one that returns nothing is an instruction rather
 * than a reading, so it keeps its own statement block.
 */
function readableMethod(method: ApiFunction): boolean {
  return method.returns === true && method.params.length === 0
}

/** Everything `[ping] 's [ … ]` can read: attributes bare, methods bracketed. */
function readableMembers(klass: ApiClass): { label: string; value: string }[] {
  return [
    ...klass.properties.map((name) => ({ label: name, value: name })),
    ...klass.methods
      .filter(readableMethod)
      // THE BRACKETS ARE IN THE LABEL, not just in the generated line. A
      // learner picking between `unit` and `distance()` is being shown the
      // difference that trips everybody up — a reading you ASK for, and a value
      // that is simply there — at the moment they choose between them.
      .map((method) => ({ label: `${method.name}()`, value: `${method.name}()` }))
  ]
}

/** One class → the block that makes one, the block that reads it, the one that sets it. */
function classBlocks(module: string, klass: ApiClass): ManifestBlock[] {
  const out: ManifestBlock[] = []
  const init = klass.init ?? []
  const initParams = constructorSockets(init)
  const obj = objectArg(klass)
  if (expressible(init)) {
    out.push({
      id: `new_${klass.name}`,
      message: `make %1 a ${klass.name}${initParams.map((_, i) => ` %${i + 2}`).join('')}`,
      args: [obj, ...args(initParams)],
      // `from range_finder import RangeFinder`, so the line the block writes is
      // the line the learner would have written. Importing the MODULE and
      // saying `range_finder.RangeFinder(...)` is equally correct Python and
      // not what any driver's own README shows.
      imports: [{ module, name: klass.name }],
      code: `{OBJ} = ${klass.name}(${callArgs(init, initParams)})`,
      tooltip: `Make a ${klass.name} and give it a name. Put this above your loop — every other ${klass.name} block takes the name.`
    })
  }
  const members = readableMembers(klass)
  if (members.length > 0) {
    out.push({
      id: `${klass.name}_get`,
      message: "%1 's %2",
      shape: 'value',
      args: [obj, { name: 'MEMBER', kind: 'choice', options: members }],
      code: '{OBJ}.{MEMBER}',
      tooltip: `Read something off a ${klass.name} — pick which from the menu.`
    })
  }
  if (klass.settable.length > 0) {
    out.push({
      id: `${klass.name}_set`,
      message: "set %1 's %2 to %3",
      args: [
        obj,
        {
          name: 'MEMBER',
          kind: 'choice',
          options: klass.settable.map((name) => ({ label: name, value: name }))
        },
        { name: 'VALUE', kind: 'any' }
      ],
      code: '{OBJ}.{MEMBER} = {VALUE}',
      tooltip: `Change something on a ${klass.name}. Only the parts that can be changed are on the menu.`
    })
  }
  for (const method of klass.methods) {
    // Already in the dropdown above, and two blocks writing one line would be
    // two shelf entries for the same thing — and an ambiguity for the reader.
    if (readableMethod(method)) continue
    if (!expressible(method.params)) continue
    const params = socketable(method.params)
    out.push({
      id: `${klass.name}_${method.name}`,
      // The object LAST, as it reads aloud: `text "hi" 0 0 on [oled]`.
      message: `${methodMessage(method, params)} on %${params.length + 1}`,
      args: [...args(params), obj],
      ...(method.returns ? { shape: 'value' as const } : {}),
      code: `{OBJ}.${method.name}(${callArgs(method.params, params)})`,
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
 *  - A METHOD is an `onField` rule — a call on WHATEVER the learner named the
 *    object, whose name goes into the block's variable field rather than into a
 *    socket, because that is where the block holds it (#1209).
 *  - A MODULE FUNCTION is a `module.fn` rule, `time.sleep`'s shape.
 *  - A ZERO-ARGUMENT READING and a PROPERTY are {@link objectRulesForModule}'s,
 *    because one block with a dropdown covers both and neither is a call the
 *    `CallRule` table can describe on its own.
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
      if (readableMethod(method)) {
        // `ping.distance()` is the member dropdown's, not a block of its own.
        rules.push({
          fn: method.name,
          type: typeFor(`${klass.name}_get`),
          onField: 'OBJ',
          args: [],
          fields: { MEMBER: `${method.name}()` },
          shape: 'value'
        })
        continue
      }
      rules.push({
        fn: method.name,
        type: typeFor(`${klass.name}_${method.name}`),
        onField: 'OBJ',
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

/**
 * THE TWO SHAPES A `CallRule` CANNOT DESCRIBE (#1209).
 *
 * `ping.unit` is not a call at all, and `ping = RangeFinder(echo_pin=0)` is a
 * call whose whole point is the name on its left — neither fits a table keyed
 * on "a function, and what goes in its sockets". They are what kept the
 * constructor line grey in the first cut of this feature: the reader had
 * nothing to say about it, so the learner's own declaration came back as a raw
 * Python block sitting above blocks that had forgotten they were about it.
 *
 * ONE RULE PER CLASS, not one per member: the block is one block with a
 * dropdown, so reading a member back means setting that dropdown.
 */
export function objectRulesForModule(
  api: ModuleApi,
  typeFor: (id: string) => string
): { members: MemberRule[]; constructs: ConstructRule[] } {
  const members: MemberRule[] = []
  const constructs: ConstructRule[] = []
  for (const klass of api.classes) {
    for (const name of klass.properties) {
      members.push({
        attr: name,
        type: typeFor(`${klass.name}_get`),
        onField: 'OBJ',
        fields: { MEMBER: name },
        ...(klass.settable.includes(name)
          ? { set: { type: typeFor(`${klass.name}_set`), value: 'VALUE' } }
          : {})
      })
    }
    const init = klass.init ?? []
    if (!expressible(init)) continue
    const sockets = constructorSockets(init)
    constructs.push({
      klass: klass.name,
      module: api.module,
      type: typeFor(`new_${klass.name}`),
      nameField: 'OBJ',
      // Exactly the sockets the block has, in the form the block writes them:
      // a required parameter positionally, a defaulted one as its keyword. A
      // line that says it any other way is somebody else's line and stays raw.
      args: init.filter((p) => sockets.includes(p) && p.default === undefined).map((p) => placeholder(p.name)),
      keywords: Object.fromEntries(
        init
          .filter((p) => sockets.includes(p) && p.default !== undefined)
          .map((p) => [p.name, placeholder(p.name)])
      )
    })
  }
  return { members, constructs }
}
