/**
 * ONE CATALOGUE PER RUNTIME (#763, epic #209).
 * =============================================================================
 *
 * Picks the symbols the editor should suggest for the dialect in use, out of the
 * MicroPython/plain-Python catalogue (`micropython-symbols.ts`) and the
 * CircuitPython one (`circuitpython-symbols.ts`).
 *
 * Pure and DOM-free so it can be tested without Monaco. The completion provider
 * calls these and does nothing else clever.
 *
 * The `unknown` case is the interesting one. It is NOT "MicroPython by default"
 * — collapsing `unknown` into MicroPython is the bug in #770 and the assumption
 * epic #209 exists to remove — and it is not "nothing", because somebody
 * reading code with no board plugged in still deserves completions. So an
 * unestablished dialect gets BOTH catalogues, with every dialect-specific entry
 * carrying a `MicroPython ·` / `CircuitPython ·` tag in its detail line. Nothing
 * is hidden and nothing is passed off as universal.
 */
import type { Dialect } from '../../../shared/dialect'
import {
  API_EQUIVALENTS,
  apiFor,
  dialectTag,
  inScope,
  otherDialect,
  type DialectScope
} from '../../../shared/dialect-api'
import { CLASS_MEMBERS, MODULES, type ModuleSymbol, type SymbolMember } from './micropython-symbols'
import { CIRCUITPYTHON_CLASS_MEMBERS, CIRCUITPYTHON_MODULES } from './circuitpython-symbols'

/** Every module either catalogue knows about, unfiltered. */
export const ALL_MODULES: ModuleSymbol[] = [...MODULES, ...CIRCUITPYTHON_MODULES]

/**
 * A member's effective scope: its own if it declares one, otherwise the scope of
 * the module (or class) it belongs to. `time.sleep_ms` is MicroPython-only
 * inside a module that exists on both, which is why members can override.
 */
export function memberScope(member: SymbolMember, ownerScope: DialectScope): DialectScope {
  return member.scope ?? ownerScope
}

/** The members of a module or class that exist on `dialect`. */
function membersFor(
  members: SymbolMember[] | undefined,
  ownerScope: DialectScope,
  dialect: Dialect
): SymbolMember[] {
  return (members ?? []).filter((m) => inScope(memberScope(m, ownerScope), dialect))
}

/**
 * The modules to offer after `import`/`from`, for one dialect — with each
 * module's members already filtered, so `time.` on CircuitPython never suggests
 * `sleep_ms`.
 *
 * Ordering keeps the MicroPython/shared catalogue first and appends the
 * CircuitPython one, which only matters for `unknown` (a known dialect sees
 * modules from one side plus the shared ones).
 */
export function modulesFor(dialect: Dialect): ModuleSymbol[] {
  return ALL_MODULES.filter((m) => inScope(m.scope, dialect)).map((m) => ({
    ...m,
    members: membersFor(m.members, m.scope, dialect)
  }))
}

/** {@link modulesFor} as a name lookup, for `module.` completions. */
export function modulesByNameFor(dialect: Dialect): Record<string, ModuleSymbol> {
  return Object.fromEntries(modulesFor(dialect).map((m) => [m.name, m]))
}

/**
 * Class members for `Klass.` completions, for one dialect.
 *
 * `I2C` is defined in both catalogues under the same name and they are genuinely
 * different classes — `busio.I2C` has `try_lock`, `machine.I2C` does not. On a
 * known dialect only that runtime's version is used. On `unknown` the two are
 * merged by member name, first definition winning, so a reader sees the union
 * rather than an arbitrary one of the pair.
 */
export function classMembersFor(dialect: Dialect): Record<string, SymbolMember[]> {
  const out: Record<string, SymbolMember[]> = {}
  const add = (table: Record<string, SymbolMember[]>, ownerScope: DialectScope): void => {
    for (const [name, members] of Object.entries(table)) {
      const kept = membersFor(members, ownerScope, dialect)
      if (kept.length === 0) continue
      const existing = out[name]
      if (!existing) {
        out[name] = kept
        continue
      }
      const seen = new Set(existing.map((m) => m.name))
      out[name] = [...existing, ...kept.filter((m) => !seen.has(m.name))]
    }
  }
  if (dialect !== 'circuitpython') add(CLASS_MEMBERS, 'micropython')
  if (dialect !== 'micropython') add(CIRCUITPYTHON_CLASS_MEMBERS, 'circuitpython')
  return out
}

/**
 * The `detail` line for a suggestion — the module's own description, prefixed
 * with the runtime it belongs to only when the reader can't otherwise tell
 * (i.e. only when the dialect is unestablished). Saying "MicroPython ·" on every
 * row of a MicroPython session would be noise; saying nothing when both are on
 * screen is the lie.
 */
export function detailFor(
  detail: string | undefined,
  scope: DialectScope | undefined,
  dialect: Dialect
): string {
  const tag = dialectTag(scope, dialect)
  const text = detail ?? ''
  if (!tag) return text
  return text ? `${tag} · ${text}` : tag
}

/** A module name from the wrong runtime, and what to do instead. */
export interface CrossDialectHint {
  /** The module the user is reaching for (`machine`). */
  name: string
  /** One line for the suggestion's detail (`Not on CircuitPython — use board + digitalio`). */
  detail: string
  /** Markdown for the hover: what to write instead, as runnable code. */
  doc: string
}

/**
 * The "you're about to import the other Python's module" hints, for the import
 * context. Empty when the dialect isn't established — nothing is wrong yet, and
 * both catalogues are on offer anyway.
 *
 * This is the moment the mistake actually happens: somebody copies `from machine
 * import Pin` out of a tutorial, and every line after it fails on their board.
 * The suggestion list is where they already are.
 */
export function crossDialectHints(dialect: Dialect): CrossDialectHint[] {
  const other = otherDialect(dialect)
  if (!other) return []
  const runtime = dialect === 'circuitpython' ? 'CircuitPython' : 'MicroPython'
  const out: CrossDialectHint[] = []
  const seen = new Set<string>()
  // A module that exists HERE too is never a hint (`time` is on both, and only
  // some of its members differ — that is the member filter's job, not this).
  const mine = new Set(modulesFor(dialect).map((m) => m.name))
  for (const row of API_EQUIVALENTS) {
    const there = apiFor(row, other)
    const here = apiFor(row, dialect)
    if (!there || !here) continue
    for (const name of there.modules) {
      if (mine.has(name) || seen.has(name)) continue
      seen.add(name)
      const how =
        here.modules.length > 0
          ? `use ${here.modules.join(' + ')}`
          : `see “${row.title}” in the help`
      out.push({
        name,
        detail: `Not on ${runtime} — ${how}`,
        doc: [
          `\`${name}\` does not exist on ${runtime}. For ${row.title.toLowerCase()}:`,
          '',
          '```python',
          here.snippet,
          '```',
          ...(row.note ? ['', row.note] : [])
        ].join('\n')
      })
    }
  }
  return out
}
