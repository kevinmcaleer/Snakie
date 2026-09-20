/**
 * `blocks.yml` — THE BLOCK MANIFEST (#1017, epic #1007).
 * =============================================================================
 *
 * A hand-maintained palette can only ever cover the parts we thought of. The
 * parts library is in the hundreds and grows through a skill; the blocks have to
 * come from the same place the parts do or they will be permanently, visibly
 * behind. So a block becomes a piece of DATA: a part folder can carry a
 * `blocks.yml` beside its `parts.yml`, a Python plugin can return the same shape
 * over the JSON-RPC host, and neither one means touching Electron code.
 *
 * This module is the whole language, and nothing else: types, a tolerant parser,
 * a tidy writer, and the template renderer both consumers share. No Blockly, no
 * React, no `fs` — so the rules that decide what a stranger's file is allowed to
 * do to a child's program are tested in plain node, and the same parse runs in
 * the main process, the renderer and the web build.
 *
 * THE SCHEMA-SAFETY RULE (epic #856). Nothing is eaten in silence. A key we do
 * not know, a block we had to drop, a version from the future — each one comes
 * back as a WARNING with the block's id in it, because the author of a
 * `blocks.yml` is usually not the person who will see it fail. The parse never
 * throws for content: a bad block is dropped and named, and the rest of the file
 * still loads. Only genuinely unreadable YAML fails the file.
 *
 * WHY A TEMPLATE AND NOT A FUNCTION. The obvious design is "let the manifest
 * supply JavaScript". It is also the design where installing a part runs a
 * stranger's code in the renderer. A template can only ever produce a STRING,
 * out of values Snakie itself computed, and the worst a hostile one can do is
 * write silly Python into a file the user can read. That is the security
 * boundary of the whole feature, and it is why `code` is a string with holes in
 * it rather than anything cleverer.
 */

import { isDialectScope, type DialectScope } from './dialect-api'
import { parse, stringify } from 'yaml'

/** The manifest schema version this build understands. */
export const BLOCKS_MANIFEST_VERSION = 1

/**
 * The two tiers a manifest block can sit in (#1213, epic #1206).
 *
 * The same word, and the same meaning, as `BlockDefinition.level` in the
 * renderer's registry — spelled again here because this module is the shared
 * language and knows nothing about Blockly. `manifest.ts` hands one straight to
 * the other.
 */
export type ManifestBlockLevel = 'simple' | 'advanced'

/** The level a block means when it says nothing. */
export const DEFAULT_MANIFEST_BLOCK_LEVEL: ManifestBlockLevel = 'simple'

const BLOCK_LEVELS: readonly ManifestBlockLevel[] = ['simple', 'advanced']

/** Is this one of the two levels? */
export function isManifestBlockLevel(value: unknown): value is ManifestBlockLevel {
  return typeof value === 'string' && BLOCK_LEVELS.includes(value as ManifestBlockLevel)
}

/**
 * What one argument IS — which decides both the shape on the block and how its
 * value reaches the template.
 *
 * The first five are SOCKETS: a hole another block plugs into, so the value can
 * be computed. The rest are FIELDS: chosen or typed on the block itself, so the
 * value is fixed and always present.
 *
 * `statements` is the C-shape — a body of blocks, rendered already indented.
 */
export type BlockArgKind =
  | 'number'
  | 'text'
  | 'boolean'
  | 'any'
  | 'statements'
  | 'number-field'
  | 'text-field'
  | 'choice'
  | 'toggle'
  | 'pin'

/** Sockets take a plugged block; fields hold their own value. */
export const SOCKET_KINDS: readonly BlockArgKind[] = ['number', 'text', 'boolean', 'any', 'statements']

const ARG_KINDS: readonly BlockArgKind[] = [
  ...SOCKET_KINDS,
  'number-field',
  'text-field',
  'choice',
  'toggle',
  'pin'
]

/** One option in a `choice` dropdown. */
export interface BlockChoice {
  /** What the dropdown shows. */
  label: string
  /**
   * What the template gets — written into the generated Python VERBATIM.
   *
   * Verbatim on purpose: a choice is usually a constant (`Pin.OUT`, `0x76`) and
   * quoting it would break every one of those. A choice that means a string
   * carries its own quotes, and the docs say so in as many words.
   */
  value: string
}

export interface BlockArgSpec {
  /** The name the template refers to it by: `{ANGLE}`. */
  name: string
  kind: BlockArgKind
  /** Shown before the field/socket when the message doesn't already say it. */
  label?: string
  /**
   * The value to start with: a socket's shadow block, a field's initial value.
   *
   * A socket with no default is an EMPTY HOLE, and a beginner meeting one has to
   * discover that blocks plug into blocks before their first program can run.
   * Every numeric socket should have one.
   */
  default?: string | number | boolean
  /** `choice` only — the dropdown's options, in order. */
  options?: BlockChoice[]
  /** `pin` only — filter the dropdown to pins that can do this job. */
  capability?: string
  /**
   * Sockets only — pre-fill this hole with ANOTHER block from this manifest,
   * named by its id.
   *
   * The composition that makes a derived part palette usable: "read %1 of %2"
   * arrives out of the flyout with the part's own sensor block already plugged
   * into it, so the first drag produces a working program rather than a shape
   * with a hole in it. A `default` covers a literal; this covers a block.
   */
  shadow?: string
}

/**
 * A hoisted construction: the object this block calls, built once above the
 * main program rather than every time the block runs.
 *
 * This is the piece that makes part blocks worth having. A sensor read inside a
 * loop must not re-open the I²C bus three thousand times a second, and a
 * manifest author should not have to know that — they declare what the object IS
 * and the generator decides where it goes.
 */
export interface BlockSetupSpec {
  /**
   * The identity of the THING, so two blocks that mean the same object share
   * one. Templated like the rest, so "the sensor on bus 0" and "the sensor on
   * bus 1" are different keys. Defaults to the expression itself.
   */
  key?: string
  /** The variable name to suggest, e.g. `sensor`. Defaults to the block's id. */
  name?: string
  /** The construction, e.g. `VL53L0X(I2C(0, sda=Pin({SDA}), scl=Pin({SCL})))`. */
  expr: string
}

/** One import the block needs whenever it emits. */
export interface BlockImportSpec {
  /** The module: `time`, `machine`, `vl53l0x`. */
  module: string
  /** For `from <module> import <name>`. */
  name?: string
  /** For `import <module> as <alias>`. Ignored alongside `name`. */
  alias?: string
}

export interface ManifestBlock {
  /**
   * Unique within its manifest. The registered Blockly type is this id
   * NAMESPACED by its source, so two parts may both ship a `read` without
   * colliding — see `blockTypeFor`.
   */
  id: string
  /** The Blockly message: `move %1 steps`, with `%1…%n` in argument order. */
  message: string
  args?: BlockArgSpec[]
  /** `statement` (default) stacks; `value` plugs into a socket. */
  shape?: 'statement' | 'value'
  /** `value` only — the type it returns (`Number`, `String`, `Boolean`). */
  output?: string
  /** The Python, with `{ARG}` holes. `{SETUP}` is the hoisted object's name. */
  code: string
  setup?: BlockSetupSpec
  imports?: BlockImportSpec[]
  tooltip?: string
  /**
   * An IN-APP help article id (e.g. `ref-pins`) — not a URL.
   *
   * Blockly's own `helpUrl` opens a web page, and a child on a locked-down
   * school network, or a Chromebook with no connection at all (epic #267), gets
   * nothing. The help library ships inside the app.
   */
  help?: string
  /**
   * Which runtime this block is true for (#1039): `both` (the default),
   * `micropython` or `circuitpython`.
   *
   * A part's driver is very often written for one of them and not the other, and
   * the author of the `blocks.yml` is the only person who knows which. Saying so
   * here keeps the block out of the toolbox of a board that cannot run it —
   * HIDDEN, never unregistered, so a program already using it still opens.
   */
  scope?: DialectScope
  /**
   * SIMPLE OR ADVANCED (#1213, epic #1206) — who the block is offered to.
   *
   * The toolbox's third filter, and the one a manifest author is best placed to
   * set: a drawer full of a part's raw register writes belongs behind "Show
   * advanced blocks", while its `read distance` block does not. Absent means
   * `simple`, so an existing `blocks.yml` keeps every block it had.
   *
   * Like `scope`, it filters the FLYOUT and never the registry: a program using
   * an advanced block still opens, renders and generates in simple mode. And a
   * plugin or part drawer whose every block is advanced simply isn't built.
   */
  level?: ManifestBlockLevel
  /** An explicit block colour. Omit it and the block wears its category's. */
  colour?: string
  /** Lay the arguments out in a row rather than stacked. Defaults to true. */
  inline?: boolean
}

export interface BlocksManifest {
  version: number
  blocks: ManifestBlock[]
}

export interface BlocksManifestResult {
  manifest: BlocksManifest
  /** Everything we could not honour, each naming the block it came from. */
  warnings: string[]
}

/** An empty manifest — what an absent or unreadable file resolves to. */
export function emptyBlocksManifest(): BlocksManifest {
  return { version: BLOCKS_MANIFEST_VERSION, blocks: [] }
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

/** The name the hoisted object binds to inside `code`. */
export const SETUP_PLACEHOLDER = 'SETUP'

/**
 * Walk a template, calling `onHole` for each `{NAME}` and `onText` for the rest.
 *
 * `{{` and `}}` are literal braces, which a template needs more often than you
 * would think — an f-string, a dict, a `format()` call. One scanner rather than
 * a regex so the escape and the hole can't disagree about what they matched.
 */
function scanTemplate(
  template: string,
  onText: (text: string) => void,
  onHole: (name: string) => void
): void {
  let buffer = ''
  let i = 0
  while (i < template.length) {
    const ch = template[i]
    if ((ch === '{' || ch === '}') && template[i + 1] === ch) {
      buffer += ch
      i += 2
      continue
    }
    if (ch === '{') {
      const end = template.indexOf('}', i + 1)
      const name = end === -1 ? '' : template.slice(i + 1, end)
      if (end !== -1 && /^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
        if (buffer) {
          onText(buffer)
          buffer = ''
        }
        onHole(name)
        i = end + 1
        continue
      }
    }
    buffer += ch
    i += 1
  }
  if (buffer) onText(buffer)
}

/** Every `{NAME}` a template refers to, in order, deduplicated. */
export function templatePlaceholders(template: string): string[] {
  const seen: string[] = []
  scanTemplate(
    template,
    () => undefined,
    (name) => {
      if (!seen.includes(name)) seen.push(name)
    }
  )
  return seen
}

/**
 * Fill a template. `values` maps a placeholder to the Python it becomes; a name
 * with no value is left as the empty string, because a block that emits a
 * half-written line is easier to see and fix than one that emits `undefined`.
 */
export function renderTemplate(template: string, values: Readonly<Record<string, string>>): string {
  let out = ''
  scanTemplate(
    template,
    (text) => {
      out += text
    },
    (name) => {
      out += values[name] ?? ''
    }
  )
  return out
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

const BLOCK_KEYS = new Set([
  'id',
  'message',
  'args',
  'shape',
  'output',
  'code',
  'setup',
  'imports',
  'tooltip',
  'help',
  'scope',
  'level',
  'colour',
  'color',
  'inline'
])
const ARG_KEYS = new Set(['name', 'kind', 'label', 'default', 'options', 'capability', 'shadow'])
const SETUP_KEYS = new Set(['key', 'name', 'expr'])
const IMPORT_KEYS = new Set(['module', 'name', 'alias'])
const MANIFEST_KEYS = new Set(['version', 'blocks'])

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}

/** Report every key we don't know about — epic #856's rule, applied literally. */
function reportUnknown(
  raw: Record<string, unknown>,
  known: Set<string>,
  where: string,
  warnings: string[]
): void {
  for (const key of Object.keys(raw)) {
    if (!known.has(key)) warnings.push(`${where}: unknown field "${key}" was ignored`)
  }
}

function coerceChoices(raw: unknown, where: string, warnings: string[]): BlockChoice[] {
  if (!Array.isArray(raw)) return []
  const out: BlockChoice[] = []
  for (const item of raw) {
    // `[label, value]` is Blockly's own spelling and the one an author copying
    // its docs will reach for; the mapping form is the one that reads.
    if (Array.isArray(item) && item.length >= 2) {
      out.push({ label: String(item[0]), value: String(item[1]) })
      continue
    }
    if (isRecord(item) && item.value !== undefined) {
      out.push({ label: String(item.label ?? item.value), value: String(item.value) })
      continue
    }
    if (typeof item === 'string' || typeof item === 'number') {
      out.push({ label: String(item), value: String(item) })
      continue
    }
    warnings.push(`${where}: an option was not a [label, value] pair and was dropped`)
  }
  return out
}

function coerceArg(raw: unknown, where: string, warnings: string[]): BlockArgSpec | null {
  if (!isRecord(raw)) {
    warnings.push(`${where}: an argument was not a mapping and was dropped`)
    return null
  }
  reportUnknown(raw, ARG_KEYS, where, warnings)
  const name = String(raw.name ?? '').trim()
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    warnings.push(`${where}: argument name "${raw.name ?? ''}" is not a valid template name`)
    return null
  }
  const kindRaw = String(raw.kind ?? 'number')
  const kind = ARG_KINDS.find((k) => k === kindRaw)
  if (!kind) {
    warnings.push(`${where}: argument "${name}" has unknown kind "${kindRaw}"`)
    return null
  }
  const arg: BlockArgSpec = { name, kind }
  if (typeof raw.label === 'string' && raw.label.trim()) arg.label = raw.label.trim()
  if (raw.default !== undefined && raw.default !== null) {
    const d = raw.default
    arg.default = typeof d === 'number' || typeof d === 'boolean' ? d : String(d)
  }
  if (typeof raw.capability === 'string' && raw.capability.trim()) {
    arg.capability = raw.capability.trim()
  }
  if (typeof raw.shadow === 'string' && raw.shadow.trim()) {
    if (!SOCKET_KINDS.includes(kind) || kind === 'statements') {
      warnings.push(`${where}: "${name}" is a field, so it cannot have a block shadow`)
    } else {
      arg.shadow = raw.shadow.trim()
    }
  }
  if (kind === 'choice') {
    const options = coerceChoices(raw.options, `${where} argument "${name}"`, warnings)
    if (options.length === 0) {
      warnings.push(`${where}: choice "${name}" has no options`)
      return null
    }
    arg.options = options
  }
  return arg
}

function coerceImport(raw: unknown, where: string, warnings: string[]): BlockImportSpec | null {
  if (typeof raw === 'string') {
    const module = raw.trim()
    return module ? { module } : null
  }
  if (!isRecord(raw)) {
    warnings.push(`${where}: an import was not a mapping and was dropped`)
    return null
  }
  reportUnknown(raw, IMPORT_KEYS, where, warnings)
  const module = String(raw.module ?? '').trim()
  if (!module) {
    warnings.push(`${where}: an import had no module and was dropped`)
    return null
  }
  const out: BlockImportSpec = { module }
  if (typeof raw.name === 'string' && raw.name.trim()) out.name = raw.name.trim()
  else if (typeof raw.alias === 'string' && raw.alias.trim()) out.alias = raw.alias.trim()
  return out
}

function coerceSetup(raw: unknown, where: string, warnings: string[]): BlockSetupSpec | undefined {
  if (raw === undefined || raw === null) return undefined
  if (typeof raw === 'string') {
    const expr = raw.trim()
    return expr ? { expr } : undefined
  }
  if (!isRecord(raw)) {
    warnings.push(`${where}: setup was not a mapping and was ignored`)
    return undefined
  }
  reportUnknown(raw, SETUP_KEYS, where, warnings)
  const expr = String(raw.expr ?? '').trim()
  if (!expr) {
    warnings.push(`${where}: setup has no expression and was ignored`)
    return undefined
  }
  const out: BlockSetupSpec = { expr }
  if (typeof raw.key === 'string' && raw.key.trim()) out.key = raw.key.trim()
  if (typeof raw.name === 'string' && raw.name.trim()) out.name = raw.name.trim()
  return out
}

/**
 * One raw mapping → one block, or null with the reason recorded.
 *
 * The last check is the important one: every `{HOLE}` in `code` and `setup` has
 * to name an argument that exists. A template referring to an argument nobody
 * declared is a block that will emit a hole into a child's program, so it is
 * dropped HERE, once, with the author's own placeholder name in the warning —
 * rather than at generation time, silently, on somebody else's machine.
 */
function coerceBlock(raw: unknown, index: number, warnings: string[]): ManifestBlock | null {
  const where = `block ${index + 1}`
  if (!isRecord(raw)) {
    warnings.push(`${where}: not a mapping, dropped`)
    return null
  }
  reportUnknown(raw, BLOCK_KEYS, where, warnings)
  const id = String(raw.id ?? '').trim()
  if (!/^[A-Za-z_][A-Za-z0-9_-]*$/.test(id)) {
    warnings.push(`${where}: id "${raw.id ?? ''}" is missing or not a plain name, dropped`)
    return null
  }
  const named = `block "${id}"`
  const message = String(raw.message ?? '').trim()
  if (!message) {
    warnings.push(`${named}: has no message, dropped`)
    return null
  }
  const code = typeof raw.code === 'string' ? raw.code : ''
  if (!code.trim()) {
    warnings.push(`${named}: has no code template, dropped`)
    return null
  }

  const args: BlockArgSpec[] = []
  if (raw.args !== undefined && raw.args !== null) {
    if (!Array.isArray(raw.args)) warnings.push(`${named}: args was not a list and was ignored`)
    else {
      for (const item of raw.args) {
        const arg = coerceArg(item, named, warnings)
        if (!arg) continue
        if (args.some((a) => a.name === arg.name)) {
          warnings.push(`${named}: two arguments are both called "${arg.name}"`)
          continue
        }
        args.push(arg)
      }
    }
  }

  const imports: BlockImportSpec[] = []
  if (raw.imports !== undefined && raw.imports !== null) {
    if (!Array.isArray(raw.imports)) warnings.push(`${named}: imports was not a list and was ignored`)
    else {
      for (const item of raw.imports) {
        const imp = coerceImport(item, named, warnings)
        if (imp) imports.push(imp)
      }
    }
  }

  const setup = coerceSetup(raw.setup, named, warnings)
  const shapeRaw = String(raw.shape ?? '').trim().toLowerCase()
  const output = typeof raw.output === 'string' && raw.output.trim() ? raw.output.trim() : undefined
  // `output: Number` on its own means a value block — saying both would be a
  // second way to state one fact, and the two could then disagree.
  const shape: 'statement' | 'value' =
    shapeRaw === 'value' || (shapeRaw !== 'statement' && output !== undefined) ? 'value' : 'statement'
  if (shapeRaw && shapeRaw !== 'value' && shapeRaw !== 'statement') {
    warnings.push(`${named}: unknown shape "${shapeRaw}", treated as a statement`)
  }
  if (shape === 'statement' && output) {
    warnings.push(`${named}: output is only meaningful on a value block, ignored`)
  }

  const block: ManifestBlock = { id, message, code, shape }
  if (args.length > 0) block.args = args
  if (shape === 'value' && output) block.output = output
  if (setup) block.setup = setup
  if (imports.length > 0) block.imports = imports
  if (typeof raw.tooltip === 'string' && raw.tooltip.trim()) block.tooltip = raw.tooltip.trim()
  if (typeof raw.help === 'string' && raw.help.trim()) block.help = raw.help.trim()
  if (raw.scope !== undefined) {
    const scope = String(raw.scope).trim()
    if (isDialectScope(scope)) {
      // `both` is the default, so recording it would only make the definition
      // noisier without changing anything.
      if (scope !== 'both') block.scope = scope
    } else {
      warnings.push(
        `${named}: scope must be one of both, micropython, circuitpython — ignored`
      )
    }
  }
  if (raw.level !== undefined) {
    const level = String(raw.level).trim().toLowerCase()
    if (isManifestBlockLevel(level)) {
      // `simple` is the default, so recording it would only make the definition
      // noisier without changing anything.
      if (level !== DEFAULT_MANIFEST_BLOCK_LEVEL) block.level = level
    } else {
      warnings.push(`${named}: level must be one of simple, advanced — ignored`)
    }
  }
  const colour = raw.colour ?? raw.color
  if (typeof colour === 'string' && colour.trim()) block.colour = colour.trim()
  if (typeof raw.inline === 'boolean') block.inline = raw.inline

  // Every hole has to name something. `{SETUP}` is ours, and only exists on a
  // block that declares one.
  const argNames = new Set(args.map((a) => a.name))
  if (setup && templatePlaceholders(setup.expr).includes(SETUP_PLACEHOLDER)) {
    // A setup expression cannot refer to its own result, and saying so by name
    // beats the infinite regress it would otherwise describe.
    warnings.push(`${named}: setup cannot refer to {${SETUP_PLACEHOLDER}} — that IS the setup`)
    return null
  }
  const holes = [...templatePlaceholders(code), ...(setup ? templatePlaceholders(setup.expr) : [])]
  for (const hole of holes) {
    if (argNames.has(hole)) continue
    if (hole === SETUP_PLACEHOLDER && setup) continue
    warnings.push(
      hole === SETUP_PLACEHOLDER
        ? `${named}: template refers to {${SETUP_PLACEHOLDER}} but the block declares no setup, dropped`
        : argNames.size === 0
          ? `${named}: template refers to {${hole}} but the block has no arguments, dropped`
          : `${named}: template refers to {${hole}}, which is not one of its arguments, dropped`
    )
    return null
  }

  // The message has to have a slot for every argument, or the field is built and
  // then never shown — a value the learner cannot see or change.
  const slots = new Set((message.match(/%\d+/g) ?? []).map((m) => Number(m.slice(1))))
  for (let i = 1; i <= args.length; i++) {
    if (!slots.has(i)) {
      warnings.push(
        `${named}: message has no %${i} for argument "${args[i - 1].name}", so it would be invisible — dropped`
      )
      return null
    }
  }
  for (const slot of slots) {
    if (slot < 1 || slot > args.length) {
      warnings.push(`${named}: message uses %${slot} but the block has ${args.length} argument(s), dropped`)
      return null
    }
  }

  return block
}

/**
 * Parse a `blocks.yml`. Tolerant by design: a bad block is dropped and named,
 * and everything else in the file still loads.
 *
 * Throws only when the YAML itself cannot be read — a caller that has a file at
 * all should report that, because it means the author's editor saved something
 * no parser will accept.
 */
export function parseBlocksManifest(text: string): BlocksManifestResult {
  return normaliseBlocksManifest(parse(text) as unknown)
}

/**
 * The same gate, over an already-decoded value.
 *
 * A part ships YAML; a Python plugin returns JSON over the RPC host. They are
 * the same manifest and they must be held to the same rules — a plugin is not a
 * more trusted author than a part, it just arrives through a different pipe. So
 * the parse is the text-shaped front door and this is the structure-shaped one,
 * and there is exactly one set of rules behind both.
 */
export function normaliseBlocksManifest(raw: unknown): BlocksManifestResult {
  const warnings: string[] = []
  if (raw === null || raw === undefined || raw === '') {
    return { manifest: emptyBlocksManifest(), warnings }
  }
  // A bare list of blocks is what an author writes first, and refusing it to
  // insist on a two-line header would be pedantry with a cost.
  const body: Record<string, unknown> = Array.isArray(raw) ? { blocks: raw } : isRecord(raw) ? raw : {}
  if (!Array.isArray(raw) && !isRecord(raw)) {
    warnings.push('blocks.yml: expected a mapping with a "blocks" list')
    return { manifest: emptyBlocksManifest(), warnings }
  }
  reportUnknown(body, MANIFEST_KEYS, 'blocks.yml', warnings)

  const versionRaw = body.version
  const version = Number.isFinite(Number(versionRaw)) ? Number(versionRaw) : BLOCKS_MANIFEST_VERSION
  if (version > BLOCKS_MANIFEST_VERSION) {
    // Not an error: a newer manifest's blocks may still be perfectly readable,
    // and refusing the file outright would turn a forward-compatible addition
    // into a part that suddenly has no blocks at all.
    warnings.push(
      `blocks.yml: version ${version} is newer than this Snakie understands (${BLOCKS_MANIFEST_VERSION}) — some blocks may be missing`
    )
  }

  const list = body.blocks
  if (list !== undefined && !Array.isArray(list)) {
    warnings.push('blocks.yml: "blocks" was not a list')
    return { manifest: { version, blocks: [] }, warnings }
  }

  const blocks: ManifestBlock[] = []
  const seen = new Set<string>()
  ;(list ?? []).forEach((item, i) => {
    const block = coerceBlock(item, i, warnings)
    if (!block) return
    if (seen.has(block.id)) {
      warnings.push(`block "${block.id}": a second block has the same id, dropped`)
      return
    }
    seen.add(block.id)
    blocks.push(block)
  })

  // A shadow naming a block that isn't here would ask Blockly for a type nobody
  // defined, and Blockly answers that by throwing while the flyout opens — one
  // bad reference taking the whole toolbox with it. Resolved against the FINAL
  // block list, so it also catches a shadow pointing at a block that was itself
  // dropped a moment ago.
  const ids = new Set(blocks.map((b) => b.id))
  for (const block of blocks) {
    for (const arg of block.args ?? []) {
      if (arg.shadow && !ids.has(arg.shadow)) {
        warnings.push(
          `block "${block.id}": "${arg.name}" wants a shadow of "${arg.shadow}", which is not a block in this file`
        )
        delete arg.shadow
      }
    }
  }

  return { manifest: { version, blocks }, warnings }
}

/**
 * Write a manifest back out. Round-trip stable: parsing this text returns the
 * same manifest, which is what epic #856 means by round-trip tested.
 */
export function blocksManifestToYaml(manifest: BlocksManifest): string {
  const out: Record<string, unknown> = { version: manifest.version }
  out.blocks = manifest.blocks.map((b) => {
    const block: Record<string, unknown> = { id: b.id, message: b.message }
    if (b.args && b.args.length > 0) {
      block.args = b.args.map((a) => {
        const arg: Record<string, unknown> = { name: a.name, kind: a.kind }
        if (a.label !== undefined) arg.label = a.label
        if (a.default !== undefined) arg.default = a.default
        if (a.capability !== undefined) arg.capability = a.capability
        if (a.shadow !== undefined) arg.shadow = a.shadow
        if (a.options) arg.options = a.options.map((o) => ({ label: o.label, value: o.value }))
        return arg
      })
    }
    block.shape = b.shape ?? 'statement'
    if (b.output !== undefined) block.output = b.output
    block.code = b.code
    if (b.setup) {
      const setup: Record<string, unknown> = {}
      if (b.setup.key !== undefined) setup.key = b.setup.key
      if (b.setup.name !== undefined) setup.name = b.setup.name
      setup.expr = b.setup.expr
      block.setup = setup
    }
    if (b.imports && b.imports.length > 0) {
      block.imports = b.imports.map((i) => {
        const imp: Record<string, unknown> = { module: i.module }
        if (i.name !== undefined) imp.name = i.name
        if (i.alias !== undefined) imp.alias = i.alias
        return imp
      })
    }
    if (b.tooltip !== undefined) block.tooltip = b.tooltip
    if (b.help !== undefined) block.help = b.help
    if (b.scope !== undefined) block.scope = b.scope
    if (b.level !== undefined) block.level = b.level
    if (b.colour !== undefined) block.colour = b.colour
    if (b.inline !== undefined) block.inline = b.inline
    return block
  })
  return stringify(out, { lineWidth: 0 })
}
