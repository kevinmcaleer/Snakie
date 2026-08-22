/**
 * Foundation tests for the refactoring engine (epic #634, phase R0 / #799).
 *
 * Covers the parser, the scope analysis and the engine's safety contract. The
 * per-rule behaviour lives in `refactorGolden.test.ts`; what is asserted here is
 * that the machinery every rule stands on is sound — including the property
 * sweep that runs the WHOLE catalogue over every real Python file in the repo
 * and demands the result still parses and is idempotent (epic §4).
 */
import { describe, expect, it } from 'vitest'
import { execSync } from 'child_process'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { parsePython } from '../src/shared/refactor/parser'
import { tokenize } from '../src/shared/refactor/lexer'
import {
  applyOffer,
  capabilityAllows,
  createContext,
  detectAll,
  nestingDepth,
  offersFor,
  runRuleToFixpoint
} from '../src/shared/refactor/engine'
import { ALL_RULES, ruleById, safeRules } from '../src/shared/refactor/rules'
import {
  applyEdits,
  dedent,
  detectEol,
  detectIndentUnit,
  fullLineRange,
  indentAt,
  LineIndex
} from '../src/shared/refactor/text'
import {
  freshName,
  hasEscapingControlFlow,
  isReadAfter,
  localBindings,
  namesRead,
  namesWritten,
  readBeforeWritten,
  referencesTo
} from '../src/shared/refactor/scope'
import { invertCondition, isCallTo, isPureExpression, literalNumber } from '../src/shared/refactor/expr'
import type { BoardCapabilities } from '../src/shared/refactor/types'
import { defineRule } from '../src/shared/refactor/types'
import type { AnyNode, Expr, FunctionDef, IfStmt } from '../src/shared/refactor/ast'
import { childrenOf } from '../src/shared/refactor/ast'

const REPO = resolve(__dirname, '..')

/** Every real Python file in the repo — the corpus the epic asks us to sweep. */
function repoPythonFiles(): string[] {
  const roots = ['examples', 'python', 'micropython'].map((d) => resolve(REPO, d))
  const out = execSync(`find ${roots.map((r) => `'${r}'`).join(' ')} -name '*.py' 2>/dev/null || true`, {
    encoding: 'utf8'
  })
  return out.trim().split('\n').filter(Boolean)
}

const CAPS: BoardCapabilities = {
  native: true,
  viper: true,
  asm: 'thumb',
  pio: true,
  machine: 'Raspberry Pi Pico with RP2040',
  version: '1.24.0',
  memFree: 180000,
  stateMachines: 8
}

describe('python lexer (#634 R0)', () => {
  it('emits significant indent/dedent and skips blank and comment-only lines', () => {
    const { tokens, comments } = tokenize('def f():\n\n    # note\n    return 1\n')
    const kinds = tokens.map((t) => t.type)
    expect(kinds).toContain('indent')
    expect(kinds).toContain('dedent')
    expect(comments.map((c) => c.text)).toEqual(['# note'])
    expect(comments[0].ownLine).toBe(true)
  })

  it('joins lines implicitly inside brackets and explicitly after a backslash', () => {
    expect(tokenize('x = (1 +\n     2)\n').errors).toEqual([])
    expect(tokenize('y = 1 + \\\n    2\n').errors).toEqual([])
    // One logical line each, so exactly one NEWLINE token.
    expect(tokenize('x = (1 +\n     2)\n').tokens.filter((t) => t.type === 'newline')).toHaveLength(1)
  })

  it('reads string prefixes, triple quotes and adjacent concatenation', () => {
    const { tokens, errors } = tokenize('s = rb"\\x00" f"a{b}" \'\'\'x\ny\'\'\'\n')
    expect(errors).toEqual([])
    expect(tokens.filter((t) => t.type === 'string')).toHaveLength(3)
  })
})

describe('python parser (#634 R0)', () => {
  it('parses every Python file in the repo without errors', () => {
    const files = repoPythonFiles()
    expect(files.length).toBeGreaterThan(20)
    const failures = files
      .map((f) => ({ f, errors: parsePython(readFileSync(f, 'utf8')).errors }))
      .filter((r) => r.errors.length > 0)
      .map((r) => `${r.f}: ${r.errors[0].message}`)
    expect(failures).toEqual([])
  })

  it.each([
    ['unclosed bracket', 'x = foo(1, 2\n'],
    ['unterminated string', 'x = "abc\n'],
    ['inconsistent dedent', 'def f():\n    a = 1\n  b = 2\n'],
    ['missing colon', 'if x\n    pass\n'],
    ['stray character', 'x = 1 ?\n'],
    ['half-typed statement', 'for i in \n'],
    ['match statement (unsupported by design)', 'match x:\n    case 1:\n        pass\n']
  ])('fails closed on %s', (_name, src) => {
    expect(parsePython(src).errors.length).toBeGreaterThan(0)
    expect(createContext(src)).toBeNull()
  })

  it('treats `match` as an ordinary name, since MicroPython has no match statement', () => {
    expect(parsePython('match = re.match(p, s)\nif match:\n    pass\n').errors).toEqual([])
  })

  it('keeps every child node inside its parent range', () => {
    const src = readFileSync(resolve(REPO, 'python/snakie/__init__.py'), 'utf8')
    const { module, errors } = parsePython(src)
    expect(errors).toEqual([])
    const violations: string[] = []
    const check = (n: AnyNode): void => {
      for (const c of childrenOf(n)) {
        if (c.start < n.start || c.end > n.end) violations.push(`${n.type} < ${c.type}`)
        check(c)
      }
    }
    check(module)
    expect(violations).toEqual([])
  })

  it('records the offsets a rewrite needs: node text round-trips from the source', () => {
    const src = 'value = compute(a, b) + 3\n'
    const { module } = parsePython(src)
    const stmt = module.body[0]
    expect(src.slice(stmt.start, stmt.end)).toBe('value = compute(a, b) + 3')
  })
})

describe('source text helpers (#634 R0)', () => {
  it('detects the file\'s own indent unit rather than assuming four spaces', () => {
    expect(detectIndentUnit('def f():\n    pass\n')).toBe('    ')
    expect(detectIndentUnit('def f():\n  pass\n')).toBe('  ')
    expect(detectIndentUnit('def f():\n\tpass\n')).toBe('\t')
    expect(detectIndentUnit('x = 1\n')).toBe('    ')
  })

  it('detects the file\'s own line ending', () => {
    expect(detectEol('a = 1\nb = 2\n')).toBe('\n')
    expect(detectEol('a = 1\r\nb = 2\r\n')).toBe('\r\n')
  })

  it('refuses overlapping or out-of-range edits instead of corrupting the file', () => {
    const src = 'abcdef'
    expect(applyEdits(src, [{ start: 0, end: 3, newText: 'X' }])).toBe('Xdef')
    expect(
      applyEdits(src, [
        { start: 0, end: 3, newText: 'X' },
        { start: 2, end: 4, newText: 'Y' }
      ])
    ).toBeNull()
    expect(applyEdits(src, [{ start: 0, end: 99, newText: 'X' }])).toBeNull()
  })

  it('dedents without leaving trailing whitespace on blank lines', () => {
    expect(dedent('    a\n\n    b\n', '    ')).toBe('a\n\nb\n')
  })

  it('maps offsets to 1-based line/column like Monaco', () => {
    const idx = new LineIndex('ab\ncd\n')
    expect(idx.positionAt(0)).toEqual({ line: 1, column: 1 })
    expect(idx.positionAt(3)).toEqual({ line: 2, column: 1 })
    expect(idx.offsetAt({ line: 2, column: 2 })).toBe(4)
  })

  it('takes whole lines when asked for a statement\'s line range', () => {
    const src = 'x = 1\ny = 2\n'
    const { module } = parsePython(src)
    expect(fullLineRange(src, module.body[1])).toEqual({ start: 6, end: 12 })
    expect(indentAt('    y = 2', 5)).toBe('    ')
  })
})

describe('condition inversion (#634 R0)', () => {
  const invert = (code: string): string => {
    const src = `if ${code}:\n    pass\n`
    const ctx = createContext(src)!
    return invertCondition(ctx, (ctx.module.body[0] as IfStmt).test)
  }

  it.each([
    ['x is not None', 'x is None'],
    ['x is None', 'x is not None'],
    ['a == b', 'a != b'],
    ['a != b', 'a == b'],
    ['a < b', 'a >= b'],
    ['a >= b', 'a < b'],
    ['k in d', 'k not in d'],
    ['k not in d', 'k in d'],
    ['not ready', 'ready'],
    ['True', 'False'],
    ['a == 1 and b > 2', 'a != 1 or b <= 2'],
    ['a == 1 or b > 2', 'a != 1 and b <= 2']
  ])('inverts %s to %s', (input, expected) => {
    expect(invert(input)).toBe(expected)
  })

  it('wraps anything it cannot invert cleanly, rather than guessing', () => {
    expect(invert('sensor.ready and tries > 0')).toBe('not (sensor.ready and tries > 0)')
    expect(invert('flag')).toBe('not flag')
    expect(invert('check()')).toBe('not check()')
  })

  it('never distributes a chained comparison, whose negation is not a chain', () => {
    expect(invert('a < b < c')).toBe('not (a < b < c)')
  })
})

describe('expression helpers (#634 R0)', () => {
  const exprOf = (code: string): Expr => {
    const ctx = createContext(`x = ${code}\n`)!
    return (ctx.module.body[0] as { value: Expr }).value
  }

  it('treats calls and subscripts as impure, so rules never duplicate them', () => {
    expect(isPureExpression(exprOf('a + b'))).toBe(true)
    expect(isPureExpression(exprOf('obj.attr'))).toBe(true)
    expect(isPureExpression(exprOf('read()'))).toBe(false)
    expect(isPureExpression(exprOf('buf[0]'))).toBe(false)
  })

  it('matches a call through either import style', () => {
    const call = (code: string) => exprOf(code)
    expect(isCallTo(call('time.sleep(1)'), ['time', 'utime'], 'sleep')).toBe(true)
    expect(isCallTo(call('utime.sleep(1)'), ['time', 'utime'], 'sleep')).toBe(true)
    expect(isCallTo(call('sleep(1)'), ['time', 'utime'], 'sleep')).toBe(true)
    expect(isCallTo(call('bus.sleep(1)'), ['time', 'utime'], 'sleep')).toBe(false)
  })

  it('reads numeric literals including negatives and separators', () => {
    expect(literalNumber(exprOf('25'))).toBe(25)
    expect(literalNumber(exprOf('-3'))).toBe(-3)
    expect(literalNumber(exprOf('1_000'))).toBe(1000)
    expect(literalNumber(exprOf('0xFF'))).toBe(255)
    expect(literalNumber(exprOf('"s"'))).toBeNull()
  })
})

describe('scope analysis (#634 R0)', () => {
  const bodyOfFirstFunction = (src: string): FunctionDef =>
    createContext(src)!.module.body.find((s) => s.type === 'FunctionDef') as FunctionDef

  it('finds the names a block reads before it writes them (extract-function params)', () => {
    const fn = bodyOfFirstFunction('def f(a, b):\n    total = a + b\n    total = total * 2\n    return total\n')
    expect(readBeforeWritten(fn.body)).toEqual(['a', 'b'])
  })

  it('orders a self-assignment as read-then-write', () => {
    const fn = bodyOfFirstFunction('def f():\n    x = x + 1\n')
    expect(readBeforeWritten(fn.body)).toEqual(['x'])
  })

  it('counts an augmented assignment as both a read and a write', () => {
    const fn = bodyOfFirstFunction('def f():\n    n += 1\n')
    expect(namesRead(fn.body).has('n')).toBe(true)
    expect(namesWritten(fn.body).has('n')).toBe(true)
  })

  it('binds for-targets, with-as, except-as, imports, defs and the walrus', () => {
    const fn = bodyOfFirstFunction(
      'def f():\n' +
        '    import machine\n' +
        '    from time import sleep as nap\n' +
        '    for i in range(3):\n' +
        '        pass\n' +
        '    with open("f") as fh:\n' +
        '        pass\n' +
        '    try:\n' +
        '        pass\n' +
        '    except OSError as err:\n' +
        '        pass\n' +
        '    def inner():\n' +
        '        pass\n' +
        '    if (n := 1):\n' +
        '        pass\n'
    )
    const bound = localBindings(fn.body)
    for (const name of ['machine', 'nap', 'i', 'fh', 'err', 'inner', 'n']) {
      expect(bound.has(name), `expected ${name} to be bound`).toBe(true)
    }
  })

  it('reads `a` but does not bind it for `a.b = 1` or `a[i] = 1`', () => {
    const fn = bodyOfFirstFunction('def f(a, i):\n    a.b = 1\n    a[i] = 2\n')
    expect(namesWritten(fn.body).has('a')).toBe(false)
    expect(namesRead(fn.body).has('a')).toBe(true)
    expect(namesRead(fn.body).has('i')).toBe(true)
  })

  it('keeps a comprehension target out of the enclosing scope', () => {
    const fn = bodyOfFirstFunction('def f(xs):\n    ys = [q * 2 for q in xs]\n    return ys\n')
    expect(namesWritten(fn.body).has('q')).toBe(false)
    expect(namesWritten(fn.body).has('ys')).toBe(true)
  })

  it('does not leak a nested function\'s locals into the enclosing scope', () => {
    const fn = bodyOfFirstFunction('def f():\n    def inner(p):\n        hidden = p\n        return hidden\n    return inner\n')
    expect(namesWritten(fn.body).has('hidden')).toBe(false)
    expect(namesWritten(fn.body).has('p')).toBe(false)
    expect(namesWritten(fn.body).has('inner')).toBe(true)
  })

  it('answers "is this name read after here?" — the extract-function return set', () => {
    const fn = bodyOfFirstFunction('def f():\n    a = 1\n    b = 2\n    return b\n')
    const bStmt = fn.body[1]
    expect(isReadAfter(fn, 'b', bStmt.end)).toBe(true)
    expect(isReadAfter(fn, 'a', bStmt.end)).toBe(false)
  })

  it('finds every reference to a name, for rename (#451)', () => {
    const fn = bodyOfFirstFunction('def f(speed):\n    speed = speed + 1\n    return speed\n')
    expect(referencesTo(fn, 'speed')).toHaveLength(3)
  })

  it('picks a fresh name that cannot collide', () => {
    const fn = bodyOfFirstFunction('def f():\n    total = 1\n    total2 = 2\n')
    expect(freshName(fn, 'total')).toBe('total3')
    expect(freshName(fn, 'other')).toBe('other')
  })

  it('spots control flow that would change meaning if extracted', () => {
    const withReturn = bodyOfFirstFunction('def f():\n    if x:\n        return 1\n')
    expect(hasEscapingControlFlow(withReturn.body)).toBe(true)

    const selfContained = bodyOfFirstFunction('def f():\n    for i in r:\n        if i:\n            continue\n')
    expect(hasEscapingControlFlow(selfContained.body)).toBe(false)

    const danglingBreak = bodyOfFirstFunction('def f():\n    if x:\n        break\n')
    expect(hasEscapingControlFlow(danglingBreak.body)).toBe(true)
  })
})

describe('engine safety contract (#634 §2.6)', () => {
  it('offers nothing at all for a file that does not parse', () => {
    expect(createContext('def broken(:\n')).toBeNull()
  })

  it('measures nesting depth for the "too deep" hint', () => {
    const ctx = createContext('def f():\n    if a:\n        for b in c:\n            if d:\n                go()\n')!
    const fn = ctx.module.body[0] as FunctionDef
    const call = (((fn.body[0] as IfStmt).body[0] as { body: unknown[] }).body[0] as IfStmt).body[0]
    expect(nestingDepth(call)).toBe(3)
  })

  it('drops a rewrite that would leave the file unparseable', () => {
    const sabotage = defineRule<null>({
      id: 'test-sabotage',
      title: 'Break the file',
      message: 'never offered',
      catalogue: 0,
      category: 'control-flow',
      kind: 'refactor',
      severity: 'hint',
      helpArticle: 'none',
      safe: false,
      detect: (ctx) => [{ ruleId: 'test-sabotage', start: 0, end: ctx.src.length, data: null }],
      apply: () => [{ start: 0, end: 0, newText: 'def (:\n' }]
    })
    const ctx = createContext('x = 1\n')!
    const offers = detectAll(ctx, [sabotage])
    expect(offers).toHaveLength(1)
    expect(applyOffer(offers[0], ctx)).toBeNull()
  })

  it('skips a rule that throws rather than losing the whole menu', () => {
    const exploding = defineRule<null>({
      id: 'test-throws',
      title: 'Throws',
      message: 'never offered',
      catalogue: 0,
      category: 'control-flow',
      kind: 'refactor',
      severity: 'hint',
      helpArticle: 'none',
      safe: false,
      detect: () => {
        throw new Error('boom')
      },
      apply: () => null
    })
    const ctx = createContext('x = 1\n')!
    expect(detectAll(ctx, [exploding, ...ALL_RULES])).toBeDefined()
  })

  it('offers board-gated rules only when the board actually supports them', () => {
    const pioOnly = defineRule<null>({
      id: 'test-pio',
      title: 'PIO only',
      message: 'pio',
      catalogue: 0,
      category: 'board',
      kind: 'refactor',
      severity: 'hint',
      helpArticle: 'none',
      safe: false,
      requires: (caps) => caps.pio,
      detect: () => [{ ruleId: 'test-pio', start: 0, end: 1, data: null }],
      apply: () => null
    })
    const src = 'x = 1\n'
    // No board connected at all ⇒ silence.
    expect(detectAll(createContext(src)!, [pioOnly])).toEqual([])
    // Connected, but an ESP32 has no PIO.
    const esp = createContext(src, { capabilities: { ...CAPS, pio: false } })!
    expect(detectAll(esp, [pioOnly])).toEqual([])
    // Connected RP2040 ⇒ offered.
    expect(detectAll(createContext(src, { capabilities: CAPS })!, [pioOnly])).toHaveLength(1)
    expect(capabilityAllows(pioOnly, createContext(src)!)).toBe(false)
  })

  it('ranks the innermost match first for a cursor position', () => {
    const src = 'def f(bus):\n    if bus is not None:\n        a = bus.read()\n        return a\n'
    const ctx = createContext(src)!
    const cursor = src.indexOf('if bus')
    const offers = offersFor(ctx, ALL_RULES, { start: cursor, end: cursor })
    expect(offers.length).toBeGreaterThan(0)
    expect(offers[0].rule.id).toBe('guard-clause')
  })
})

describe('the catalogue itself', () => {
  it('has unique ids and catalogue numbers', () => {
    const ids = ALL_RULES.map((r) => r.id)
    expect(new Set(ids).size).toBe(ids.length)
    const numbers = ALL_RULES.map((r) => r.catalogue)
    expect(new Set(numbers).size).toBe(numbers.length)
  })

  it('gives every rule a "Why?" article id', () => {
    expect(ALL_RULES.filter((r) => !r.helpArticle)).toEqual([])
  })

  it('looks rules up by id, and the safe subset excludes hint-only rules', () => {
    expect(ruleById('guard-clause')?.catalogue).toBe(1)
    expect(safeRules().every((r) => r.safe && !r.hintOnly)).toBe(true)
  })

  it('leaves every real repo file parseable and stable under the whole catalogue', () => {
    const files = repoPythonFiles()
    const failures: string[] = []
    for (const file of files) {
      const src = readFileSync(file, 'utf8')
      for (const rule of ALL_RULES) {
        const once = runRuleToFixpoint(rule, src, { capabilities: CAPS })
        if (parsePython(once).errors.length > 0) {
          failures.push(`${rule.id} broke ${file}`)
          continue
        }
        const twice = runRuleToFixpoint(rule, once, { capabilities: CAPS })
        if (twice !== once) failures.push(`${rule.id} is not idempotent on ${file}`)
      }
    }
    expect(failures).toEqual([])
  })
})
