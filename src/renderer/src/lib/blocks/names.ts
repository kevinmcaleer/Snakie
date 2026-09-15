/**
 * PYTHON NAMES FROM BLOCK NAMES (#1010, epic #1007).
 * =============================================================================
 *
 * A learner names a variable by typing into a block, so the name that reaches
 * the generator is whatever a ten-year-old typed: `score`, but also `my score`,
 * `3 cats`, `class`, `print`, `🐢`. All of those have to come out the other side
 * as a valid Python identifier that does not blow up, shadow something load-
 * bearing, or change between one regeneration and the next.
 *
 * THREE RULES, in this order:
 *
 *  1. **Legal.** Anything Python can't put in an identifier becomes `_`, and a
 *     name that would start with a digit gets an `n` in front (`3 cats` →
 *     `n3_cats`), because a leading `_` means something else to a Python reader
 *     and we are teaching them to read Python.
 *  2. **Safe.** A keyword or a builtin we'd rather they kept gets a trailing
 *     underscore, which is PEP 8's own answer (`class_`, `list_`). Shadowing
 *     `print` is not a syntax error, which is exactly what makes it a bad
 *     afternoon for a child who then can't print anything.
 *  3. **Stable.** The same block name always yields the same identifier, and a
 *     collision with a name already in use is resolved by counting up
 *     (`score_2`), never by anything that depends on iteration order. The
 *     mirror re-renders on every workspace change; if names moved, so would
 *     every line below them and the source map with them.
 *
 * Pure and dependency-free.
 */

/** Python keywords — using one as a name is a syntax error, not a smell. */
const KEYWORDS = new Set([
  'False',
  'None',
  'True',
  'and',
  'as',
  'assert',
  'async',
  'await',
  'break',
  'class',
  'continue',
  'def',
  'del',
  'elif',
  'else',
  'except',
  'finally',
  'for',
  'from',
  'global',
  'if',
  'import',
  'in',
  'is',
  'lambda',
  'nonlocal',
  'not',
  'or',
  'pass',
  'raise',
  'return',
  'try',
  'while',
  'with',
  'yield'
])

/**
 * Builtins worth protecting. NOT all of them — shadowing `vars` costs a learner
 * nothing and a list of 150 names would rename things for no reason. These are
 * the ones whose loss is confusing precisely when you need them: the printing,
 * the types you'd convert with, the functions a first program actually calls.
 */
const BUILTINS = new Set([
  'abs',
  'all',
  'any',
  'bool',
  'bytes',
  'chr',
  'dict',
  'dir',
  'enumerate',
  'filter',
  'float',
  'format',
  'help',
  'hex',
  'id',
  'input',
  'int',
  'len',
  'list',
  'map',
  'max',
  'min',
  'next',
  'object',
  'open',
  'ord',
  'pow',
  'print',
  'range',
  'round',
  'set',
  'sorted',
  'str',
  'sum',
  'tuple',
  'type',
  'zip'
])

/** Is `name` one this module would rather the learner didn't take over? */
export function isReservedName(name: string): boolean {
  return KEYWORDS.has(name) || BUILTINS.has(name)
}

/**
 * The identifier for a block-supplied `name`, honouring `taken`.
 *
 * `taken` is every name already spoken for in the program — other variables,
 * hoisted objects, and the modules the import manager bound — so a learner's
 * variable can never quietly become the `time` module.
 */
export function toPythonIdentifier(name: string, taken: ReadonlySet<string> = EMPTY): string {
  const base = sanitise(name)
  const safe = isReservedName(base) || taken.has(base) ? `${base}_` : base
  if (!taken.has(safe) && !isReservedName(safe)) return safe
  // Count up. Starts at 2 because the thing it collides with is the 1.
  for (let n = 2; ; n++) {
    const candidate = `${base}_${n}`
    if (!taken.has(candidate) && !isReservedName(candidate)) return candidate
  }
}

/**
 * The legal-identifier half on its own, without the collision pass.
 *
 * Exported because the hoisted-object names (`led_15`) are built from pieces the
 * generator already knows are safe, and paying for a collision check twice would
 * let a name drift between the setup line and the call that uses it.
 */
export function sanitise(name: string): string {
  const cleaned = name
    .trim()
    // Anything outside the ASCII identifier set becomes a separator. Python 3
    // does allow unicode identifiers, but `🐢 = Turtle()` is a trap: it reads
    // fine here and breaks the moment the file meets an older tool.
    .replace(/[^A-Za-z0-9_]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
  if (cleaned === '') return 'value'
  return /^[0-9]/.test(cleaned) ? `n${cleaned}` : cleaned
}

const EMPTY: ReadonlySet<string> = new Set()
