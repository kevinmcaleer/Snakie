/**
 * Rule 86 — **Just import the module** (epic #634 §3.8, MicroPython).
 *
 * ```python
 * # before                          # after
 * try:                              import json
 *     import ujson
 * except ImportError:
 *     import json
 * ```
 *
 * Every MicroPython tutorial written before about 2022 opens with one of these,
 * and beginners copy them forward for years. The shim is dead weight in both
 * directions: CPython only ever had `json`, and modern MicroPython provides
 * `json` too — the `u`-prefixed spellings are deprecated aliases kept for old
 * code, and several ports have already stopped shipping them by default. So the
 * `try` branch either succeeds and gives you the *same module under a worse
 * name*, or it fails and you fall through to the line you could have written on
 * its own.
 *
 * What it costs is readability. Four lines and two indentation levels at the top
 * of the file, repeated once per module, before the reader has reached anything
 * the program actually does — and a habit that makes people think `ujson` and
 * `json` are two different things that must be reconciled.
 *
 * The bare `import ujson` / `import json` form is worth knowing about: it is
 * quietly *broken*, because the two branches bind two different names. Code
 * below it that says `json.dumps(…)` blows up with `NameError` on precisely the
 * firmware where the `try` succeeded. Collapsing it to `import json` is the fix,
 * not just the tidy-up — which is why the rule declines whenever the file still
 * reads the `u`-prefixed name, since that program means something else.
 *
 * The module names are whitelisted rather than derived by stripping a `u`:
 * `umqtt.simple` and `urequests` are real, separately-named packages, and
 * "importing them without the u" is not a thing.
 */
import type { AnyNode, Import, ImportAlias, ImportFrom, Stmt, TryStmt } from '../ast'
import { unwrap, walk } from '../ast'
import { namesRead } from '../scope'
import { indentAt, lineEnd, lineStart } from '../text'
import type { TextEdit } from '../text'
import { defineRule } from '../types'
import type { RefactorContext, RefactorMatch } from '../types'

/**
 * Modules MicroPython ships under both a plain and a `u`-prefixed name. Only
 * these are aliases of one another — `umqtt`, `urequests` and `ulogging` are
 * separate third-party packages that merely start with the same letter.
 */
const SHIMMED_MODULES = new Set([
  'array',
  'asyncio',
  'binascii',
  'bluetooth',
  'collections',
  'cryptolib',
  'ctypes',
  'errno',
  'hashlib',
  'heapq',
  'io',
  'json',
  'machine',
  'os',
  'platform',
  'queue',
  'random',
  're',
  'select',
  'socket',
  'ssl',
  'struct',
  'sys',
  'time',
  'websocket',
  'zlib'
])

interface ShimMatch {
  tryStmt: TryStmt
  /** The plain-named import that survives the collapse. */
  keep: Import | ImportFrom
  /** The module without its `u`, for the message. */
  module: string
}

/** Is `prefixed` the deprecated `u`-alias of `plain`? */
function isUAlias(prefixed: string, plain: string): boolean {
  return prefixed === `u${plain}` && SHIMMED_MODULES.has(plain)
}

/** The name an alias binds: `import a.b as c` binds `c`, `import a.b` binds `a`. */
function boundName(alias: ImportAlias): string {
  return alias.asname ?? alias.name.split('.')[0]
}

/** A stable key for one `from … import x as y` entry. */
function aliasKey(alias: ImportAlias): string {
  return `${alias.name} as ${alias.asname ?? ''}`
}

/** The `try:` / `except ImportError:` shape, or null. One statement each side. */
function shimBranches(t: TryStmt): { tried: Stmt; fallback: Stmt } | null {
  if (t.body.length !== 1 || t.handlers.length !== 1) return null
  // An `else:` or `finally:` runs code we would be deleting.
  if (t.orelse.length > 0 || t.finalbody.length > 0) return null

  const handler = t.handlers[0]
  // `except ImportError as err:` binds a name the rest of the file may read.
  if (handler.name || handler.isStar || !handler.exc) return null
  const exc = unwrap(handler.exc)
  // Exactly `ImportError`. A tuple of exception types is catching something
  // else as well, and that something else is not ours to remove.
  if (exc.type !== 'Name' || exc.id !== 'ImportError') return null
  if (handler.body.length !== 1) return null

  return { tried: t.body[0], fallback: handler.body[0] }
}

/** The shim this `try` is, or null when it is any other try/except. */
function matchShim(ctx: RefactorContext, t: TryStmt): ShimMatch | null {
  const branches = shimBranches(t)
  if (!branches) return null
  const { tried, fallback } = branches

  if (tried.type === 'Import' && fallback.type === 'Import') {
    // `import a, b` in a shim is not an idiom anyone writes, and collapsing it
    // would need every alias to line up. One module each side only.
    if (tried.names.length !== 1 || fallback.names.length !== 1) return null
    const prefixed = tried.names[0]
    const plain = fallback.names[0]
    // A dotted module (`import uasyncio.core`) is a package path, not an alias.
    if (prefixed.name.includes('.') || plain.name.includes('.')) return null
    if (!isUAlias(prefixed.name, plain.name)) return null

    // `import ujson` binds `ujson`; `import json` binds `json`. Dropping the
    // try leaves only the second, so the first had better be unused — if the
    // file reads `ujson`, this program depends on the branch we would delete.
    if (boundName(prefixed) !== boundName(plain)) {
      if (namesRead([...ctx.module.body]).has(boundName(prefixed))) return null
    }
    return { tryStmt: t, keep: fallback, module: plain.name }
  }

  if (tried.type === 'ImportFrom' && fallback.type === 'ImportFrom') {
    if (tried.level !== 0 || fallback.level !== 0) return null
    if (tried.isStar || fallback.isStar) return null
    if (!tried.module || !fallback.module) return null
    if (!isUAlias(tried.module, fallback.module)) return null
    // The two branches must import exactly the same set of names under exactly
    // the same local spellings, or the collapse changes what is bound. Compared
    // as sets *both ways*: `from ujson import dumps, dumps` is the same length
    // as `from json import dumps, loads` and one-way containment would pass it,
    // even though collapsing would newly bind `loads` over whatever the file
    // already had by that name.
    const triedKeys = new Set(tried.names.map(aliasKey))
    const keptKeys = new Set(fallback.names.map(aliasKey))
    if (triedKeys.size !== tried.names.length || keptKeys.size !== fallback.names.length) return null
    if (triedKeys.size !== keptKeys.size) return null
    if (![...keptKeys].every((k) => triedKeys.has(k))) return null
    return { tryStmt: t, keep: fallback, module: fallback.module }
  }

  return null
}

export const dropUModuleShimRule = defineRule<ShimMatch>({
  id: 'drop-u-module-shim',
  title: 'Just import the module',
  message: 'The `u`-prefixed name is a deprecated alias — this try/except shim can go',
  catalogue: 86,
  category: 'micropython',
  kind: 'refactor',
  severity: 'hint',
  helpArticle: 'refactor-drop-u-module-shim',
  safe: true,

  detect(ctx: RefactorContext): RefactorMatch<ShimMatch>[] {
    const out: RefactorMatch<ShimMatch>[] = []
    walk(ctx.module as AnyNode, (node) => {
      if (node.type !== 'Try') return
      const data = matchShim(ctx, node)
      if (!data) return
      out.push({
        ruleId: 'drop-u-module-shim',
        start: node.start,
        end: node.end,
        message: `\`u${data.module}\` is a deprecated alias for \`${data.module}\` — modern MicroPython and CPython both have the plain name`,
        data
      })
    })
    return out
  },

  apply(match: RefactorMatch<ShimMatch>, ctx: RefactorContext): TextEdit[] | null {
    const { tryStmt, keep } = match.data

    const from = lineStart(ctx.src, tryStmt.start)
    // A `try` sharing its line with something else (after a `;`) is not ours.
    if (ctx.src.slice(from, tryStmt.start).trim() !== '') return null
    if (ctx.src.slice(lineStart(ctx.src, keep.start), keep.start).trim() !== '') return null

    const to = lineEnd(ctx.src, tryStmt.end)
    // The kept import is the last statement in the `try`, so it must end on the
    // same line the whole statement does — otherwise we would be dropping code.
    if (lineEnd(ctx.src, keep.end) !== to) return null

    const ownIndent = indentAt(ctx.src, tryStmt.start)
    // A comment sitting below the kept import, at the handler's deeper column,
    // is not part of any statement — so it survives the edit and is left
    // stranded under a block that no longer exists. It still parses, but it now
    // reads as belonging to something that is not there. Decline instead.
    for (let scan = to; scan < ctx.src.length; ) {
      const end = lineEnd(ctx.src, scan)
      const text = ctx.src.slice(scan, end).trim()
      if (text !== '') {
        if (!text.startsWith('#')) break
        if (indentAt(ctx.src, scan).length > ownIndent.length) return null
      }
      scan = end
    }

    // Take the import with whatever trailing comment it carries, and re-indent
    // it from the handler's column to the `try`'s own.
    const moved = ownIndent + ctx.src.slice(keep.start, to)
    return [{ start: from, end: to, newText: moved }]
  }
})
