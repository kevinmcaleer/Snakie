/**
 * READING A `.mpy`, AND BEING HONEST ABOUT WHAT IS IN ONE (#875).
 * =============================================================================
 *
 * A `.mpy` is MicroPython's precompiled-module container: `mpy-cross` turns
 * `foo.py` into `foo.mpy` and the board imports it without ever seeing the
 * source. Clicking one in the file tree used to open it in the text editor,
 * which is the worst possible answer — a screen of mojibake that says nothing.
 *
 * WHAT IS ACTUALLY RECOVERABLE, established from the format rather than assumed
 * (`py/persistentcode.c`, `py/bc.h` and `tools/mpy-tool.py` in MicroPython
 * v1.29.0, plus `docs/reference/mpyfiles.rst`):
 *
 *   RECOVERABLE
 *     - The header: magic, format version, native architecture, small-int width.
 *     - The name of the `.py` it was compiled from — the compiler interns it as
 *       qstr 0, so it survives even though nothing else of the source does.
 *     - The QSTR TABLE: every interned name the module needs. Function and class
 *       names, attribute names, imported module names, global names, and short
 *       string literals (mpy-cross interns strings under ~25 chars rather than
 *       putting them in the constant table).
 *     - The CONSTANT TABLE: longer strings, bytes, ints, floats, complex, tuples.
 *     - The SCOPE TREE, with each scope's name and its ARGUMENT NAMES: every code
 *       object carries a prelude whose "source info" section stores its own
 *       simple_name qstr followed by one qstr per positional/keyword-only
 *       argument (`py/bc.h`). So real signatures come back out.
 *
 *   NOT RECOVERABLE — not obfuscated, simply never written
 *     - The source text. Comments, formatting, blank lines, the lot.
 *     - DOCSTRINGS. MicroPython's compiler discards them outright; they are not
 *       in the constant table (verified by compiling a docstringed module and
 *       grepping the output for it).
 *     - LOCAL VARIABLE NAMES. Locals are addressed by slot number in the
 *       bytecode, so only arguments keep their names. A `for i in …` loses `i`.
 *     - `*args` / `**kwargs` NAMES, for the same reason: they are not counted in
 *       n_pos_args, so the prelude never names them (the flags survive; the
 *       names do not).
 *     - Which scopes are CLASSES and which are FUNCTIONS. Both compile to a plain
 *       code object; the difference is only visible in the PARENT's bytecode
 *       (a `LOAD_BUILD_CLASS`). Disassembly is deliberately out of scope here, so
 *       this module reports scopes and lets the caller word it honestly.
 *
 * DELIBERATELY NOT A DISASSEMBLER. It walks the container and the preludes, and
 * steps OVER each scope's opcodes. That is what makes it a hundred lines instead
 * of a thousand, and it is enough for a "what's inside this file" view.
 *
 * Pure over a `Uint8Array` so it runs in the renderer, in main, and in a node
 * unit test with no board and no Electron. Every read is bounds-checked and
 * every failure is an {@link MpyReadError}: a truncated or corrupt file must
 * produce a sentence, never a crash and never a hang.
 */

/** Why a file could not be read as a `.mpy`. Always this class, never a RangeError. */
export class MpyReadError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MpyReadError'
  }
}

/**
 * Native architectures, indexed by the header's arch number
 * (`MP_NATIVE_ARCH_*` in `py/persistentcode.h`). Index 0 = portable bytecode.
 */
export const MPY_ARCHITECTURES = [
  'none',
  'x86',
  'x64',
  'armv6',
  'armv6m',
  'armv7m',
  'armv7em',
  'armv7emsp',
  'armv7emdp',
  'xtensa',
  'xtensawin',
  'rv32imc',
  'rv64imc',
  'debug'
] as const

/**
 * The qstrs every MicroPython build has at fixed indices (`static_qstr_list` in
 * `py/makeqstrdata.py`). A `.mpy` refers to these BY NUMBER and omits the text,
 * which is why `__init__` and `self` do not appear as strings in the file — this
 * table is what turns those numbers back into names.
 *
 * The order is frozen for `.mpy` compatibility (upstream says so where it is
 * defined, and `QSTR_LAST_STATIC` in `py/persistentcode.c` pins the end), so it
 * is safe to hard-code for format version 6. A future format bump would need
 * this refreshed — an index past the end resolves to `?qstr:N` rather than
 * silently mislabelling something.
 */
// prettier-ignore
export const MPY_STATIC_QSTRS: readonly string[] = [
  '', '__dir__', '\n', ' ', '*', '/', '<module>', '_', '__call__', '__class__', '__delitem__',
  '__enter__', '__exit__', '__getattr__', '__getitem__', '__hash__', '__init__', '__int__',
  '__iter__', '__len__', '__main__', '__module__', '__name__', '__new__', '__next__',
  '__qualname__', '__repr__', '__setitem__', '__str__', 'ArithmeticError', 'AssertionError',
  'AttributeError', 'BaseException', 'EOFError', 'Ellipsis', 'Exception', 'GeneratorExit',
  'ImportError', 'IndentationError', 'IndexError', 'KeyError', 'KeyboardInterrupt', 'LookupError',
  'MemoryError', 'NameError', 'NoneType', 'NotImplementedError', 'OSError', 'OverflowError',
  'RuntimeError', 'StopIteration', 'SyntaxError', 'SystemExit', 'TypeError', 'ValueError',
  'ZeroDivisionError', 'abs', 'all', 'any', 'append', 'args', 'bool', 'builtins', 'bytearray',
  'bytecode', 'bytes', 'callable', 'chr', 'classmethod', 'clear', 'close', 'const', 'copy',
  'count', 'dict', 'dir', 'divmod', 'end', 'endswith', 'eval', 'exec', 'extend', 'find', 'format',
  'from_bytes', 'get', 'getattr', 'globals', 'hasattr', 'hash', 'id', 'index', 'insert', 'int',
  'isalpha', 'isdigit', 'isinstance', 'islower', 'isspace', 'issubclass', 'isupper', 'items',
  'iter', 'join', 'key', 'keys', 'len', 'list', 'little', 'locals', 'lower', 'lstrip', 'main',
  'map', 'micropython', 'next', 'object', 'open', 'ord', 'pop', 'popitem', 'pow', 'print',
  'range', 'read', 'readinto', 'readline', 'remove', 'replace', 'repr', 'reverse', 'rfind',
  'rindex', 'round', 'rsplit', 'rstrip', 'self', 'send', 'sep', 'set', 'setattr', 'setdefault',
  'sort', 'sorted', 'split', 'start', 'startswith', 'staticmethod', 'step', 'stop', 'str',
  'strip', 'sum', 'super', 'throw', 'to_bytes', 'tuple', 'type', 'update', 'upper', 'utf-8',
  'value', 'values', 'write', 'zip'
]

/** What kind of code a scope holds (`MP_CODE_*`, offset so 0 = bytecode). */
export type MpyCodeKind = 'bytecode' | 'native' | 'viper' | 'asm'

/** One entry of the constant-object table. */
export interface MpyConstant {
  kind: 'str' | 'bytes' | 'int' | 'float' | 'complex' | 'tuple' | 'singleton' | 'fun-table'
  /** Display form: the string itself, the number as written, `None`/`True`/… */
  value: string
}

/**
 * One code object — the module itself, or a function/class/comprehension nested
 * inside it. NOT labelled function-vs-class: see the header, the file does not
 * say which without disassembling the parent.
 */
export interface MpyScope {
  /** This scope's own name. The module's is `<module>`. */
  name: string
  /** Dotted path from the module, e.g. `Blinker.blink`. */
  qualifiedName: string
  /** Argument names, in order. Empty for a class body or a native scope. */
  args: string[]
  /** How many of the trailing POSITIONAL `args` have defaults (values are not stored). */
  nDefaultArgs: number
  /**
   * At least one keyword-only argument has a default. The format records only
   * the flag, never which arguments or what the values were — so this cannot be
   * attributed to a particular name, and {@link formatSignature} does not try.
   */
  hasKeywordDefaults: boolean
  /** Positional args; `args` also holds the keyword-only ones after these. */
  nPosArgs: number
  nKwOnlyArgs: number
  kind: MpyCodeKind
  isGenerator: boolean
  /** Takes `*args` — the flag survives, the name does not. */
  takesVarArgs: boolean
  /** Takes `**kwargs` — likewise. */
  takesVarKeywords: boolean
  /** Bytes of code for this scope alone, children excluded. */
  codeSize: number
  children: MpyScope[]
}

/**
 * Which runtime compiled this file. The two are the SAME format with different
 * magic bytes — see {@link parseMpy} — but they will not load each other's
 * modules, which is the single most useful thing to tell someone holding one.
 */
export type MpyFlavour = 'micropython' | 'circuitpython'

/** Everything this module can honestly say about a `.mpy`. */
export interface MpyInfo {
  /** MicroPython (`M`) or CircuitPython (`C`), from the magic byte. */
  flavour: MpyFlavour
  /** Format version from the header (6 for MicroPython v1.19 onwards). */
  version: number
  /**
   * Native ABI sub-version, or `null` for a bytecode-only file. mpy-cross only
   * writes it when the file contains native code, and the loader only checks it
   * then — so reporting "6.0" for portable bytecode would be inventing a fact.
   */
  subVersion: number | null
  /** `'none'` for portable bytecode, else the machine-code target. */
  arch: string
  /** Smallest small-int width the file needs the runtime to have. */
  smallIntBits: number
  hasNativeCode: boolean
  /** Architecture-specific flags vuint, present only when the header says so. */
  archFlags: number | null
  /** The `.py` this was compiled from, as interned at compile time. */
  sourceName: string | null
  /** The whole qstr table, in file order. */
  qstrs: string[]
  /** Names used as a scope name or an argument name — definitely identifiers. */
  definedNames: string[]
  /**
   * The rest of the qstr table. Identifiers the code REFERENCES (attributes,
   * globals, imported modules) mixed with short interned string literals — the
   * container does not distinguish them, so neither do we.
   */
  referencedNames: string[]
  constants: MpyConstant[]
  /** The outer module scope; its `children` are what it defines. */
  module: MpyScope
  /** Size of the file that was parsed. */
  byteLength: number
}

const decoder = new TextDecoder('utf-8', { fatal: false })

/** Sequential cursor over the file, bounds-checked on every read. */
class Cursor {
  at = 0
  constructor(readonly bytes: Uint8Array) {}

  byte(): number {
    if (this.at >= this.bytes.length) throw new MpyReadError('the file is truncated')
    return this.bytes[this.at++]
  }

  /**
   * A variably-encoded unsigned integer: 7 bits per byte, MSB set when another
   * byte follows, most-significant group FIRST (`read_uint` in
   * `py/persistentcode.c`). Capped so a run of continuation bytes in a corrupt
   * file cannot spin or overflow into nonsense.
   */
  uint(): number {
    let n = 0
    for (let i = 0; i < 8; i++) {
      const b = this.byte()
      n = n * 128 + (b & 0x7f)
      if ((b & 0x80) === 0) {
        if (!Number.isSafeInteger(n)) throw new MpyReadError('the file is corrupt (bad length)')
        return n
      }
    }
    throw new MpyReadError('the file is corrupt (a length field never ends)')
  }

  take(len: number): Uint8Array {
    if (len < 0 || this.at + len > this.bytes.length) {
      throw new MpyReadError('the file is truncated')
    }
    const out = this.bytes.subarray(this.at, this.at + len)
    this.at += len
    return out
  }

  /** A length-prefixed, NUL-terminated string, as qstr and str/bytes data are. */
  text(len: number): string {
    return decoder.decode(this.take(len))
  }
}

/** Same vuint, but stepping through a scope's prelude inside its code blob. */
function preludeUint(code: Uint8Array, ref: { at: number }): number {
  let n = 0
  for (let i = 0; i < 8; i++) {
    if (ref.at >= code.length) throw new MpyReadError('the file is corrupt (short prelude)')
    const b = code[ref.at++]
    n = n * 128 + (b & 0x7f)
    if ((b & 0x80) === 0) return n
  }
  throw new MpyReadError('the file is corrupt (a prelude field never ends)')
}

const SCOPE_FLAG_GENERATOR = 0x01
const SCOPE_FLAG_VARKEYWORDS = 0x02
const SCOPE_FLAG_VARARGS = 0x04
const SCOPE_FLAG_DEFKWARGS = 0x08
const SCOPE_FLAG_VIPERRELOC = 0x10
const SCOPE_FLAG_VIPERRODATA = 0x20
const SCOPE_FLAG_VIPERBSS = 0x40

/** Header bit 6: an architecture-specific flags vuint follows the header. */
const FEATURE_ARCH_FLAGS = 0x40

const CODE_KINDS: MpyCodeKind[] = ['bytecode', 'native', 'viper', 'asm']

/**
 * The signature and size words at the head of a code object's prelude, then the
 * qstr indices of its name and arguments (`py/bc.h`, `extract_prelude` in
 * `tools/mpy-tool.py`). Both words interleave their fields bit-wise across a
 * variable number of bytes, which is why this is transcribed rather than clever.
 */
function readPrelude(
  code: Uint8Array,
  offset: number
): {
  scopeFlags: number
  nPosArgs: number
  nKwOnlyArgs: number
  nDefArgs: number
  names: number[]
} {
  const ref = { at: offset }
  if (offset < 0 || offset >= code.length) {
    throw new MpyReadError('the file is corrupt (prelude points outside its code)')
  }

  // Signature word: xSSSSEAA [xFSSKAED …]. S (stack depth) and E (exception
  // stack depth) are decoded by the runtime but say nothing a reader wants, so
  // only the four that describe the SIGNATURE are pulled out here.
  let z = code[ref.at++]
  let F = 0
  let A = z & 0x3
  let K = 0
  let D = 0
  for (let n = 0; z & 0x80; n++) {
    // Bounded as well as end-checked: each extension byte shifts its bits n
    // places left, so a corrupt run of them would shift past 31 and wrap the
    // counts negative. A real signature never needs more than a few.
    if (n >= 8) throw new MpyReadError('the file is corrupt (a prelude field never ends)')
    if (ref.at >= code.length) throw new MpyReadError('the file is corrupt (short prelude)')
    z = code[ref.at++]
    F |= ((z & 0x40) >> 6) << n
    A |= (z & 0x4) << n
    K |= ((z & 0x08) >> 3) << n
    D |= (z & 0x1) << n
  }

  // Size word: xIIIIIIC repeated. Only read for its length — the source-info
  // and closure sections it measures are stepped over, not decoded.
  for (;;) {
    if (ref.at >= code.length) throw new MpyReadError('the file is corrupt (short prelude)')
    const b = code[ref.at++]
    if ((b & 0x80) === 0) break
  }

  // Source info: simple_name, then one qstr per positional + keyword-only arg.
  const nPosArgs = A
  const nKwOnlyArgs = K
  const names: number[] = []
  for (let i = 0; i < 1 + nPosArgs + nKwOnlyArgs; i++) names.push(preludeUint(code, ref))

  return { scopeFlags: F, nPosArgs, nKwOnlyArgs, nDefArgs: D, names }
}

/** Step over a viper scope's relocation stream (`mp_native_relocate`). */
function skipRelocations(cur: Cursor): void {
  for (;;) {
    const op = cur.byte()
    if (op === 0xff) return
    if (op & 1) cur.uint() // address to adjust
    const rest = op >> 1
    if (rest <= 5 && rest & 1) cur.uint() // number of adjustments
  }
}

/**
 * One raw-code element and, recursively, its children. `depth` only guards
 * against a corrupt file describing a tree deep enough to blow the JS stack.
 */
function readRawCode(cur: Cursor, qstrs: string[], parent: string, depth: number): MpyScope {
  if (depth > 64) throw new MpyReadError('the file is corrupt (code nested too deeply)')

  const kindLen = cur.uint()
  const kind = CODE_KINDS[kindLen & 3]
  const hasChildren = (kindLen & 4) !== 0
  const code = cur.take(kindLen >> 3)

  let preludeOffset = 0
  let nativeScopeFlags = 0
  if (kind === 'native') {
    preludeOffset = cur.uint()
  } else if (kind !== 'bytecode') {
    nativeScopeFlags = cur.uint()
    if (kind === 'viper') {
      let rodataSize = 0
      if (nativeScopeFlags & SCOPE_FLAG_VIPERRODATA) rodataSize = cur.uint()
      if (nativeScopeFlags & SCOPE_FLAG_VIPERBSS) cur.uint()
      if (nativeScopeFlags & SCOPE_FLAG_VIPERRODATA) cur.take(rodataSize)
      if (nativeScopeFlags & SCOPE_FLAG_VIPERRELOC) skipRelocations(cur)
    } else {
      cur.uint() // n_pos_args
      cur.uint() // type signature
    }
  }

  // Viper and inline-asm scopes have no prelude, so they carry no name of their
  // own in the file — mpy-tool falls back to qstr 0 for them and so do we.
  const named = kind === 'bytecode' || kind === 'native'
  const prelude = named ? readPrelude(code, preludeOffset) : null
  const nameOf = (i: number): string => qstrs[i] ?? `?qstr:${i}`
  const name = prelude ? nameOf(prelude.names[0]) : (qstrs[0] ?? '<native>')
  const scopeFlags = prelude ? prelude.scopeFlags : nativeScopeFlags

  const scope: MpyScope = {
    name,
    qualifiedName: parent ? `${parent}.${name}` : name,
    args: prelude ? prelude.names.slice(1).map(nameOf) : [],
    nDefaultArgs: prelude?.nDefArgs ?? 0,
    nPosArgs: prelude?.nPosArgs ?? 0,
    nKwOnlyArgs: prelude?.nKwOnlyArgs ?? 0,
    kind,
    isGenerator: (scopeFlags & SCOPE_FLAG_GENERATOR) !== 0,
    takesVarArgs: (scopeFlags & SCOPE_FLAG_VARARGS) !== 0,
    takesVarKeywords: (scopeFlags & SCOPE_FLAG_VARKEYWORDS) !== 0,
    hasKeywordDefaults: (scopeFlags & SCOPE_FLAG_DEFKWARGS) !== 0,
    codeSize: code.length,
    children: []
  }

  if (hasChildren) {
    // The module's own name is a placeholder, not a namespace: `<module>.foo`
    // would be noise, so children of the outer scope start their path fresh.
    const childParent = scope.qualifiedName === '<module>' ? '' : scope.qualifiedName
    const n = cur.uint()
    for (let i = 0; i < n; i++) {
      scope.children.push(readRawCode(cur, qstrs, childParent, depth + 1))
    }
  }
  return scope
}

/** Object-table type tags (`MP_PERSISTENT_OBJ_*` in `py/persistentcode.h`). */
const OBJ_FUN_TABLE = 0
const OBJ_NONE = 1
const OBJ_FALSE = 2
const OBJ_TRUE = 3
const OBJ_ELLIPSIS = 4
const OBJ_STR = 5
const OBJ_BYTES = 6
const OBJ_INT = 7
const OBJ_FLOAT = 8
const OBJ_COMPLEX = 9
const OBJ_TUPLE = 10

/** One constant object. Numbers are stored as their decimal TEXT, not as bits. */
function readObj(cur: Cursor, depth = 0): MpyConstant {
  if (depth > 16) throw new MpyReadError('the file is corrupt (constants nested too deeply)')
  const tag = cur.byte()
  switch (tag) {
    case OBJ_FUN_TABLE:
      return { kind: 'fun-table', value: 'mp_fun_table' }
    case OBJ_NONE:
      return { kind: 'singleton', value: 'None' }
    case OBJ_FALSE:
      return { kind: 'singleton', value: 'False' }
    case OBJ_TRUE:
      return { kind: 'singleton', value: 'True' }
    case OBJ_ELLIPSIS:
      return { kind: 'singleton', value: '...' }
  }

  const len = cur.uint()
  if (tag === OBJ_TUPLE) {
    const items: string[] = []
    for (let i = 0; i < len; i++) items.push(readObj(cur, depth + 1).value)
    return { kind: 'tuple', value: `(${items.join(', ')})` }
  }
  const data = cur.take(len)
  switch (tag) {
    case OBJ_STR:
      cur.byte() // NUL terminator, present so a ROM str can be referenced in place
      return { kind: 'str', value: decoder.decode(data) }
    case OBJ_BYTES:
      cur.byte()
      return { kind: 'bytes', value: decoder.decode(data) }
    case OBJ_INT:
      return { kind: 'int', value: decoder.decode(data) }
    case OBJ_FLOAT:
      return { kind: 'float', value: decoder.decode(data) }
    case OBJ_COMPLEX:
      return { kind: 'complex', value: decoder.decode(data) }
    default:
      throw new MpyReadError(`the file is corrupt (unknown constant type ${tag})`)
  }
}

/** Does this look like a `.mpy` by name? Used to route a click, not to parse. */
export function isMpyFile(name: string | undefined | null): boolean {
  return !!name && /\.mpy$/i.test(name)
}

/**
 * Read a `.mpy` container. Throws {@link MpyReadError} — with a sentence a user
 * can act on — for anything that is not one, or is one but truncated.
 */
export function parseMpy(bytes: Uint8Array): MpyInfo {
  if (bytes.length < 4) throw new MpyReadError('the file is too short to be a .mpy')
  const cur = new Cursor(bytes)

  // CircuitPython's fork writes 'C' where MicroPython writes 'M' — deliberately,
  // so neither runtime imports the other's modules (the marker in its
  // `py/persistentcode.c` reads "CIRCUITPY-CHANGE: 'C', not 'M'"). EVERYTHING
  // after that byte is the same format, static qstr table included: the two
  // `static_qstr_list`s were compared entry for entry and are identical. So both
  // are read here, and the flavour is reported rather than used to branch.
  const magic = cur.byte()
  const flavour: MpyFlavour | null =
    magic === 0x4d ? 'micropython' : magic === 0x43 ? 'circuitpython' : null
  if (!flavour) {
    throw new MpyReadError('not a .mpy file (it does not start with the magic byte "M" or "C")')
  }
  const version = cur.byte()
  const feature = cur.byte()
  const smallIntBits = cur.byte()

  // Bits 5..2 are the native arch, 1..0 the ABI sub-version, 6 says an
  // architecture-flags vuint follows, 7 is reserved (mpyfiles.rst).
  const archNumber = (feature >> 2) & 0x0f
  const arch = MPY_ARCHITECTURES[archNumber] ?? `unknown (${archNumber})`
  const hasNativeCode = archNumber !== 0

  if (version !== 6) {
    throw new MpyReadError(
      `.mpy format version ${version} — Snakie reads version 6 (MicroPython v1.19 and later)`
    )
  }

  const archFlags = (feature & FEATURE_ARCH_FLAGS) !== 0 ? cur.uint() : null

  const nQstr = cur.uint()
  const nObj = cur.uint()
  // A corrupt count would otherwise have us loop millions of times before the
  // cursor ran off the end; the file itself is an upper bound on both tables.
  if (nQstr > bytes.length || nObj > bytes.length) {
    throw new MpyReadError('the file is corrupt (its tables claim more entries than it has bytes)')
  }

  const qstrs: string[] = []
  for (let i = 0; i < nQstr; i++) {
    const len = cur.uint()
    if (len & 1) {
      // A static qstr: an index into the firmware's built-in table, no text here.
      const index = len >> 1
      qstrs.push(MPY_STATIC_QSTRS[index - 1] ?? `?qstr:${index}`)
    } else {
      const text = cur.text(len >> 1)
      cur.byte() // NUL terminator
      qstrs.push(text)
    }
  }

  const constants: MpyConstant[] = []
  for (let i = 0; i < nObj; i++) constants.push(readObj(cur))

  const module = readRawCode(cur, qstrs, '', 0)

  // Split the qstr table by how it was USED. A name that appears as a scope's
  // own name or as one of its arguments is certainly an identifier this module
  // defines; everything else is a reference or an interned literal, and the
  // container gives us no way to tell those two apart.
  const defined = new Set<string>()
  const walk = (s: MpyScope): void => {
    defined.add(s.name)
    for (const a of s.args) defined.add(a)
    s.children.forEach(walk)
  }
  walk(module)
  defined.delete('<module>')

  const sourceName = qstrs[0] || null
  const definedNames = qstrs.filter((q, i) => i > 0 && defined.has(q))
  const referencedNames = qstrs.filter((q, i) => i > 0 && q !== '<module>' && !defined.has(q))

  return {
    flavour,
    version,
    subVersion: hasNativeCode ? feature & 3 : null,
    arch,
    smallIntBits,
    hasNativeCode,
    archFlags,
    sourceName,
    qstrs,
    definedNames,
    referencedNames,
    constants,
    module,
    byteLength: bytes.length
  }
}

/**
 * A scope rendered the way its `def` line would have read — `blink(self, times=…)`.
 *
 * Default VALUES are not in the file, so a positional argument known to have one
 * shows as `…`. A KEYWORD-ONLY argument is left bare even when the scope's
 * DEFKWARGS flag is set: the flag says some of them have defaults without saying
 * which, and guessing would be worse than saying nothing. `*args`/`**kwargs` show
 * unnamed because their names are not stored at all (see the header).
 */
export function formatSignature(scope: MpyScope): string {
  const parts = scope.args.map((a, i) => {
    const isDefaulted = i >= scope.nPosArgs - scope.nDefaultArgs && i < scope.nPosArgs
    return isDefaulted ? `${a}=…` : a
  })
  // Whatever separates the positional args from the keyword-only ones goes in
  // between: the unnamed `*args` if there is one, otherwise a bare `*`.
  if (scope.takesVarArgs) parts.splice(scope.nPosArgs, 0, '*…')
  else if (scope.nKwOnlyArgs > 0) parts.splice(scope.nPosArgs, 0, '*')
  if (scope.takesVarKeywords) parts.push('**…')
  return `${scope.name}(${parts.join(', ')})`
}
