/**
 * Recursive-descent Python parser for the refactoring engine (epic #634, R0).
 *
 * ## Why not tree-sitter?
 *
 * The epic (§2.2) recommended `web-tree-sitter` + a Python grammar wasm. That
 * turned out to be the wrong trade for this codebase:
 *
 * - **CSP.** The Electron renderer ships `script-src 'self'` (see
 *   `src/renderer/index.html`). Chrome gates `WebAssembly.instantiate` on
 *   `script-src`, so a wasm parser means adding `'wasm-unsafe-eval'` to a
 *   deliberately locked-down renderer — a real security regression to buy a
 *   parser.
 * - **Bundle.** ~650 KB of wasm (runtime + grammar) on a school Chromebook, the
 *   exact worry the epic raised as an open question in §9.
 * - **Async.** `Parser.init()` is async and the wasm has to be located
 *   differently in electron-vite, the standalone web build and vitest. A pure
 *   module is synchronous and identical in all three.
 *
 * What the epic actually rejected in §2.2 was *hand-rolled indentation
 * scanning*, on the grounds that it can never answer "is this variable used
 * later?". This is not that: it is a real tokenizer (`lexer.ts`) plus a full
 * expression/statement grammar producing exact source ranges, which `scope.ts`
 * uses for genuine read/write analysis — so Extract Function and Rename stay on
 * the table.
 *
 * ## Error handling
 *
 * The parser never throws. Anything it cannot read is recorded in `errors` and
 * skipped to the next logical line. The engine refuses to offer ANY refactoring
 * for a file with errors, so an unsupported construct (`match`, or 3.12
 * f-string nesting) degrades to "no refactorings here" rather than to a bad
 * edit. That is the safe direction, and it is what acceptance criterion 1 of
 * the epic asks for.
 */
import type { Comment, Token } from './lexer'
import { tokenize } from './lexer'
import type {
  AnyNode,
  Assert,
  Assign,
  AugAssign,
  AnnAssign,
  ClassDef,
  Comprehension,
  Constant,
  Delete,
  ExceptHandler,
  Expr,
  ExprStmt,
  ForStmt,
  FunctionDef,
  Global,
  Import,
  ImportAlias,
  ImportFrom,
  IfStmt,
  Keyword,
  Module,
  Name,
  Nonlocal,
  Param,
  Raise,
  Return,
  Stmt,
  TryStmt,
  WhileStmt,
  WithItem,
  WithStmt
} from './ast'
import { linkParents } from './ast'

/** A syntax error. Its presence disables refactoring for the whole file. */
export interface ParseError {
  message: string
  start: number
  end: number
}

/** Everything a rule needs about a parsed file. */
export interface ParseResult {
  module: Module
  comments: Comment[]
  errors: ParseError[]
}

/** Comparison operators, including the two-token forms. */
const COMPARE_OPS = new Set(['<', '>', '==', '>=', '<=', '!='])

/** Augmented-assignment operators. */
const AUG_OPS = new Set([
  '+=',
  '-=',
  '*=',
  '/=',
  '//=',
  '%=',
  '@=',
  '&=',
  '|=',
  '^=',
  '>>=',
  '<<=',
  '**='
])

/** Binary operator precedence, tightest last. */
const BIN_LEVELS: string[][] = [['|'], ['^'], ['&'], ['<<', '>>'], ['+', '-'], ['*', '/', '//', '%', '@']]

class Parser {
  private i = 0
  readonly errors: ParseError[] = []

  constructor(
    private readonly tokens: Token[],
    private readonly src: string
  ) {}

  // -- token helpers --------------------------------------------------------

  private peek(offset = 0): Token {
    return this.tokens[Math.min(this.i + offset, this.tokens.length - 1)]
  }

  private cur(): Token {
    return this.peek()
  }

  private next(): Token {
    const t = this.cur()
    if (this.i < this.tokens.length - 1) this.i++
    return t
  }

  /** True when the current token is the given operator. */
  private isOp(value: string, offset = 0): boolean {
    const t = this.peek(offset)
    return t.type === 'op' && t.value === value
  }

  /** True when the current token is the given keyword/name. */
  private isName(value: string, offset = 0): boolean {
    const t = this.peek(offset)
    return t.type === 'name' && t.value === value
  }

  private eatOp(value: string): boolean {
    if (this.isOp(value)) {
      this.next()
      return true
    }
    return false
  }

  private eatName(value: string): boolean {
    if (this.isName(value)) {
      this.next()
      return true
    }
    return false
  }

  private expectOp(value: string): void {
    if (!this.eatOp(value)) this.fail(`expected '${value}'`)
  }

  private fail(message: string): void {
    const t = this.cur()
    // Only the first error per logical line is worth recording.
    const last = this.errors[this.errors.length - 1]
    if (!last || last.start !== t.start) {
      this.errors.push({ message, start: t.start, end: Math.max(t.end, t.start + 1) })
    }
  }

  /** Skip to just past the next NEWLINE, so parsing can resume on solid ground. */
  private recoverLine(): void {
    let guard = 0
    while (this.cur().type !== 'eof' && this.cur().type !== 'newline' && guard++ < 100000) this.next()
    if (this.cur().type === 'newline') this.next()
  }

  // -- statements -----------------------------------------------------------

  parseModule(): Module {
    const body: Stmt[] = []
    let guard = 0
    while (this.cur().type !== 'eof' && guard++ < 500000) {
      if (this.cur().type === 'newline' || this.cur().type === 'indent' || this.cur().type === 'dedent') {
        this.next()
        continue
      }
      const before = this.i
      const stmts = this.parseStatement()
      body.push(...stmts)
      if (this.i === before) {
        // No progress: record and skip a token so we can never spin.
        this.fail('unexpected token')
        this.next()
      }
    }
    return { type: 'Module', start: 0, end: this.src.length, body }
  }

  /** One statement, which for a `a; b` line yields several. */
  private parseStatement(): Stmt[] {
    const t = this.cur()
    if (t.type === 'op' && t.value === '@') return [this.parseDecorated()]
    if (t.type === 'name') {
      switch (t.value) {
        case 'def':
          return [this.parseFunctionDef([], t.start, false)]
        case 'class':
          return [this.parseClassDef([], t.start)]
        case 'if':
          return [this.parseIf(false)]
        case 'while':
          return [this.parseWhile()]
        case 'for':
          return [this.parseFor(t.start, false)]
        case 'try':
          return [this.parseTry()]
        case 'with':
          return [this.parseWith(t.start, false)]
        case 'async':
          return [this.parseAsync()]
      }
    }
    return this.parseSimpleLine()
  }

  /** `async def` / `async for` / `async with`. */
  private parseAsync(): Stmt {
    const start = this.cur().start
    this.next() // async
    if (this.isName('def')) return this.parseFunctionDef([], start, true)
    if (this.isName('for')) return this.parseFor(start, true)
    if (this.isName('with')) return this.parseWith(start, true)
    this.fail("expected 'def', 'for' or 'with' after 'async'")
    this.recoverLine()
    return { type: 'Pass', start, end: this.cur().start }
  }

  private parseDecorated(): Stmt {
    const start = this.cur().start
    const decorators: Expr[] = []
    while (this.isOp('@')) {
      this.next()
      decorators.push(this.parseTest())
      if (this.cur().type === 'newline') this.next()
    }
    if (this.isName('def')) return this.parseFunctionDef(decorators, start, false)
    if (this.isName('class')) return this.parseClassDef(decorators, start)
    if (this.isName('async')) {
      const asyncStart = this.cur().start
      this.next()
      if (this.isName('def')) return this.parseFunctionDef(decorators, start, true, asyncStart)
    }
    this.fail("expected 'def' or 'class' after a decorator")
    this.recoverLine()
    return { type: 'Pass', start, end: this.cur().start }
  }

  private parseFunctionDef(
    decorators: Expr[],
    start: number,
    isAsync: boolean,
    asyncStart?: number
  ): FunctionDef {
    const defStart = asyncStart ?? this.cur().start
    this.next() // def
    const nameTok = this.cur()
    let name = ''
    if (nameTok.type === 'name') {
      name = nameTok.value
      this.next()
    } else {
      this.fail('expected a function name')
    }
    this.expectOp('(')
    const params = this.parseParamList(')')
    this.expectOp(')')
    let returns: Expr | undefined
    if (this.eatOp('->')) returns = this.parseTest()
    const body = this.parseSuite()
    return {
      type: 'FunctionDef',
      start,
      end: this.endOfBlock(body, defStart),
      name,
      nameStart: nameTok.start,
      params,
      returns,
      body,
      decorators,
      isAsync,
      defStart
    }
  }

  private parseClassDef(decorators: Expr[], start: number): ClassDef {
    const defStart = this.cur().start
    this.next() // class
    const nameTok = this.cur()
    let name = ''
    if (nameTok.type === 'name') {
      name = nameTok.value
      this.next()
    } else {
      this.fail('expected a class name')
    }
    const bases: Expr[] = []
    const keywords: Keyword[] = []
    if (this.eatOp('(')) {
      this.parseCallArgs(bases, keywords)
      this.expectOp(')')
    }
    const body = this.parseSuite()
    return {
      type: 'ClassDef',
      start,
      end: this.endOfBlock(body, defStart),
      name,
      nameStart: nameTok.start,
      bases,
      keywords,
      body,
      decorators,
      defStart
    }
  }

  /** Parameters up to (not including) `close`; also used for `lambda` with ':'. */
  private parseParamList(close: string): Param[] {
    const params: Param[] = []
    let guard = 0
    while (!this.isOp(close) && this.cur().type !== 'eof' && guard++ < 10000) {
      const start = this.cur().start
      if (this.eatOp('/')) {
        params.push({ type: 'Param', start, end: this.peek(-1).end, name: '/', kind: 'posonly-marker' })
      } else if (this.isOp('*') && (this.isOp(',', 1) || this.isOp(close, 1))) {
        this.next()
        params.push({ type: 'Param', start, end: this.peek(-1).end, name: '*', kind: 'kwonly-marker' })
      } else {
        let kind: Param['kind'] = 'normal'
        if (this.eatOp('**')) kind = 'kwarg'
        else if (this.eatOp('*')) kind = 'vararg'
        const nameTok = this.cur()
        let name = ''
        if (nameTok.type === 'name') {
          name = nameTok.value
          this.next()
        } else {
          this.fail('expected a parameter name')
          break
        }
        let annotation: Expr | undefined
        let dflt: Expr | undefined
        if (close === ')' && this.eatOp(':')) annotation = this.parseTest()
        if (this.eatOp('=')) dflt = this.parseTest()
        params.push({
          type: 'Param',
          start,
          end: this.peek(-1).end,
          name,
          kind,
          annotation,
          default: dflt
        })
      }
      if (!this.eatOp(',')) break
    }
    return params
  }

  /** `: NEWLINE INDENT stmts DEDENT`, or `: simple; simple` on one line. */
  private parseSuite(): Stmt[] {
    if (!this.eatOp(':')) {
      this.fail("expected ':'")
      this.recoverLine()
      return []
    }
    if (this.cur().type === 'newline') {
      this.next()
      if (this.cur().type !== 'indent') {
        this.fail('expected an indented block')
        return []
      }
      this.next()
      const body: Stmt[] = []
      let guard = 0
      while (this.cur().type !== 'dedent' && this.cur().type !== 'eof' && guard++ < 500000) {
        if (this.cur().type === 'newline') {
          this.next()
          continue
        }
        const before = this.i
        body.push(...this.parseStatement())
        if (this.i === before) {
          this.fail('unexpected token')
          this.next()
        }
      }
      if (this.cur().type === 'dedent') this.next()
      return body
    }
    return this.parseSimpleLine()
  }

  /** The end offset of a block: the last statement's end, or the header's. */
  private endOfBlock(body: Stmt[], fallbackStart: number): number {
    if (body.length > 0) return body[body.length - 1].end
    return Math.max(fallbackStart, this.peek(-1).end)
  }

  private parseIf(isElif: boolean): IfStmt {
    const start = this.cur().start
    this.next() // if / elif
    const test = this.parseNamedTest()
    const body = this.parseSuite()
    let orelse: Stmt[] = []
    let orelseStart: number | undefined
    if (this.isName('elif')) {
      orelseStart = this.cur().start
      orelse = [this.parseIf(true)]
    } else if (this.isName('else')) {
      orelseStart = this.cur().start
      this.next()
      orelse = this.parseSuite()
    }
    return {
      type: 'If',
      start,
      end: this.endOfBlock(orelse.length ? orelse : body, start),
      test,
      body,
      orelse,
      isElif,
      orelseStart
    }
  }

  private parseWhile(): WhileStmt {
    const start = this.cur().start
    this.next()
    const test = this.parseNamedTest()
    const body = this.parseSuite()
    let orelse: Stmt[] = []
    if (this.eatName('else')) orelse = this.parseSuite()
    return {
      type: 'While',
      start,
      end: this.endOfBlock(orelse.length ? orelse : body, start),
      test,
      body,
      orelse
    }
  }

  private parseFor(start: number, isAsync: boolean): ForStmt {
    this.next() // for
    const target = this.parseTargetList(['in'])
    if (!this.eatName('in')) this.fail("expected 'in'")
    const iter = this.parseTestListStar()
    const body = this.parseSuite()
    let orelse: Stmt[] = []
    if (this.eatName('else')) orelse = this.parseSuite()
    return {
      type: 'For',
      start,
      end: this.endOfBlock(orelse.length ? orelse : body, start),
      target,
      iter,
      body,
      orelse,
      isAsync
    }
  }

  private parseWith(start: number, isAsync: boolean): WithStmt {
    this.next() // with
    const items: WithItem[] = []
    // `with (a as b, c as d):` — a parenthesised item list (3.10+). Only treat
    // the paren that way when an `as` or a trailing comma proves it is a list.
    const parenthesised = this.isOp('(') && this.looksLikeParenWithItems()
    if (parenthesised) this.next()
    let guard = 0
    do {
      const itemStart = this.cur().start
      const context = this.parseTest()
      let optionalVars: Expr | undefined
      if (this.eatName('as')) optionalVars = this.parseTarget()
      items.push({ type: 'WithItem', start: itemStart, end: this.peek(-1).end, context, optionalVars })
    } while (this.eatOp(',') && !this.isOp(')') && this.cur().type !== 'eof' && guard++ < 1000)
    if (parenthesised) this.expectOp(')')
    const body = this.parseSuite()
    return { type: 'With', start, end: this.endOfBlock(body, start), items, body, isAsync }
  }

  /** Look ahead past a balanced `(` for an `as` or `,` that means with-items. */
  private looksLikeParenWithItems(): boolean {
    let depth = 0
    for (let k = 0; k < 500; k++) {
      const t = this.peek(k)
      if (t.type === 'eof') return false
      if (t.type === 'op' && '([{'.includes(t.value)) depth++
      else if (t.type === 'op' && ')]}'.includes(t.value)) {
        depth--
        if (depth === 0) {
          // A ':' straight after the closing paren means it was the whole item.
          return false
        }
      } else if (depth === 1 && t.type === 'name' && t.value === 'as') return true
    }
    return false
  }

  private parseTry(): TryStmt {
    const start = this.cur().start
    this.next()
    const body = this.parseSuite()
    const handlers: ExceptHandler[] = []
    let orelse: Stmt[] = []
    let finalbody: Stmt[] = []
    let guard = 0
    while (this.isName('except') && guard++ < 1000) {
      const hStart = this.cur().start
      this.next()
      const isStar = this.eatOp('*')
      let exc: Expr | undefined
      let name: string | undefined
      if (!this.isOp(':')) {
        exc = this.parseTest()
        if (this.eatName('as')) {
          if (this.cur().type === 'name') name = this.next().value
          else this.fail('expected a name after "as"')
        }
      }
      const hBody = this.parseSuite()
      handlers.push({
        type: 'ExceptHandler',
        start: hStart,
        end: this.endOfBlock(hBody, hStart),
        exc,
        name,
        body: hBody,
        isStar
      })
    }
    if (this.eatName('else')) orelse = this.parseSuite()
    if (this.eatName('finally')) finalbody = this.parseSuite()
    const tail = finalbody.length
      ? finalbody
      : orelse.length
        ? orelse
        : handlers.length
          ? handlers[handlers.length - 1].body
          : body
    return {
      type: 'Try',
      start,
      end: this.endOfBlock(tail, start),
      body,
      handlers,
      orelse,
      finalbody
    }
  }

  /** A line of `;`-separated simple statements, ending at NEWLINE. */
  private parseSimpleLine(): Stmt[] {
    const out: Stmt[] = []
    let guard = 0
    for (;;) {
      const before = this.i
      out.push(this.parseSimpleStatement())
      if (this.i === before) {
        this.fail('unexpected token')
        this.recoverLine()
        break
      }
      if (this.eatOp(';')) {
        if (this.cur().type === 'newline' || this.cur().type === 'eof') break
        if (guard++ > 1000) break
        continue
      }
      break
    }
    if (this.cur().type === 'newline') this.next()
    else if (this.cur().type !== 'eof' && this.cur().type !== 'dedent') {
      this.fail('expected end of statement')
      this.recoverLine()
    }
    return out
  }

  private parseSimpleStatement(): Stmt {
    const t = this.cur()
    const start = t.start
    if (t.type === 'name') {
      switch (t.value) {
        case 'pass':
          this.next()
          return { type: 'Pass', start, end: t.end }
        case 'break':
          this.next()
          return { type: 'Break', start, end: t.end }
        case 'continue':
          this.next()
          return { type: 'Continue', start, end: t.end }
        case 'return': {
          this.next()
          let value: Expr | undefined
          if (!this.atStatementEnd()) value = this.parseTestListStar()
          return { type: 'Return', start, end: this.peek(-1).end, value } as Return
        }
        case 'raise': {
          this.next()
          let exc: Expr | undefined
          let cause: Expr | undefined
          if (!this.atStatementEnd()) {
            exc = this.parseTest()
            if (this.eatName('from')) cause = this.parseTest()
          }
          return { type: 'Raise', start, end: this.peek(-1).end, exc, cause } as Raise
        }
        case 'del': {
          this.next()
          const targets: Expr[] = []
          do {
            targets.push(this.parseTarget())
          } while (this.eatOp(','))
          return { type: 'Delete', start, end: this.peek(-1).end, targets } as Delete
        }
        case 'assert': {
          this.next()
          const test = this.parseTest()
          let msg: Expr | undefined
          if (this.eatOp(',')) msg = this.parseTest()
          return { type: 'Assert', start, end: this.peek(-1).end, test, msg } as Assert
        }
        case 'global':
        case 'nonlocal': {
          const kw = t.value
          this.next()
          const names: string[] = []
          do {
            if (this.cur().type === 'name') names.push(this.next().value)
            else this.fail('expected a name')
          } while (this.eatOp(','))
          const node = { start, end: this.peek(-1).end, names }
          return kw === 'global'
            ? ({ type: 'Global', ...node } as Global)
            : ({ type: 'Nonlocal', ...node } as Nonlocal)
        }
        case 'import':
          return this.parseImport(start)
        case 'from':
          return this.parseImportFrom(start)
      }
    }
    return this.parseExprStatement(start)
  }

  private atStatementEnd(): boolean {
    return (
      this.cur().type === 'newline' ||
      this.cur().type === 'eof' ||
      this.cur().type === 'dedent' ||
      this.isOp(';')
    )
  }

  private parseDottedName(): { name: string; start: number; end: number } {
    const start = this.cur().start
    let name = ''
    if (this.cur().type === 'name') name = this.next().value
    else this.fail('expected a module name')
    while (this.isOp('.') && this.peek(1).type === 'name') {
      this.next()
      name += '.' + this.next().value
    }
    return { name, start, end: this.peek(-1).end }
  }

  private parseImport(start: number): Import {
    this.next() // import
    const names: ImportAlias[] = []
    do {
      const aStart = this.cur().start
      const dotted = this.parseDottedName()
      let asname: string | undefined
      if (this.eatName('as') && this.cur().type === 'name') asname = this.next().value
      names.push({ type: 'ImportAlias', start: aStart, end: this.peek(-1).end, name: dotted.name, asname })
    } while (this.eatOp(','))
    return { type: 'Import', start, end: this.peek(-1).end, names }
  }

  private parseImportFrom(start: number): ImportFrom {
    this.next() // from
    let level = 0
    while (this.isOp('.') || this.isOp('...')) {
      level += this.cur().value.length
      this.next()
    }
    let module: string | undefined
    if (!this.isName('import')) module = this.parseDottedName().name
    if (!this.eatName('import')) this.fail("expected 'import'")
    const names: ImportAlias[] = []
    let isStar = false
    if (this.eatOp('*')) {
      isStar = true
    } else {
      const paren = this.eatOp('(')
      do {
        if (paren && this.isOp(')')) break
        const aStart = this.cur().start
        let name = ''
        if (this.cur().type === 'name') name = this.next().value
        else {
          this.fail('expected an imported name')
          break
        }
        let asname: string | undefined
        if (this.eatName('as') && this.cur().type === 'name') asname = this.next().value
        names.push({ type: 'ImportAlias', start: aStart, end: this.peek(-1).end, name, asname })
      } while (this.eatOp(','))
      if (paren) this.expectOp(')')
    }
    return { type: 'ImportFrom', start, end: this.peek(-1).end, module, names, level, isStar }
  }

  /** Assignment, augmented assignment, annotated assignment, or a bare expr. */
  private parseExprStatement(start: number): Stmt {
    const first = this.parseTestListStar()

    if (this.cur().type === 'op' && AUG_OPS.has(this.cur().value)) {
      const op = this.next().value.slice(0, -1)
      const value = this.parseTestListStar()
      return { type: 'AugAssign', start, end: value.end, target: first, op, value } as AugAssign
    }

    if (this.isOp(':')) {
      this.next()
      const annotation = this.parseTest()
      let value: Expr | undefined
      if (this.eatOp('=')) value = this.parseTestListStar()
      return {
        type: 'AnnAssign',
        start,
        end: this.peek(-1).end,
        target: first,
        annotation,
        value
      } as AnnAssign
    }

    if (this.isOp('=')) {
      const targets: Expr[] = [first]
      let value: Expr = first
      let guard = 0
      while (this.eatOp('=') && guard++ < 100) {
        value = this.parseTestListStar()
        targets.push(value)
      }
      targets.pop() // the last one parsed is the value, not a target
      return { type: 'Assign', start, end: value.end, targets, value } as Assign
    }

    return { type: 'ExprStmt', start, end: first.end, value: first } as ExprStmt
  }

  // -- targets --------------------------------------------------------------

  /** A single assignment/`for` target (name, attribute, subscript, star, group). */
  private parseTarget(): Expr {
    return this.parseUnaryPostfix()
  }

  /** `a, b` / `(a, b)` up to one of `stops` (a keyword) or `=`. */
  private parseTargetList(stops: string[]): Expr {
    const start = this.cur().start
    const first = this.parseTarget()
    if (!this.isOp(',')) return first
    const elts: Expr[] = [first]
    while (this.eatOp(',')) {
      if (this.cur().type === 'name' && stops.includes(this.cur().value)) break
      if (this.atStatementEnd() || this.isOp('=')) break
      elts.push(this.parseTarget())
    }
    return { type: 'Tuple', start, end: elts[elts.length - 1].end, elts, parenthesized: false }
  }

  // -- expressions ----------------------------------------------------------

  /** `a, b, *c` — produces a Tuple only when a comma is actually present. */
  private parseTestListStar(): Expr {
    const start = this.cur().start
    const first = this.parseStarOrTest()
    if (!this.isOp(',')) return first
    const elts: Expr[] = [first]
    let trailing = false
    while (this.eatOp(',')) {
      if (this.atStatementEnd() || this.isOp('=') || this.isOp(')') || this.isOp(']') || this.isOp('}')) {
        trailing = true
        break
      }
      elts.push(this.parseStarOrTest())
    }
    const end = trailing ? this.peek(-1).end : elts[elts.length - 1].end
    return { type: 'Tuple', start, end, elts, parenthesized: false }
  }

  private parseStarOrTest(): Expr {
    if (this.isOp('*')) {
      const start = this.cur().start
      this.next()
      const value = this.parseTest()
      return { type: 'Starred', start, end: value.end, value }
    }
    return this.parseNamedTest()
  }

  /** `x := expr`, else a plain test. */
  private parseNamedTest(): Expr {
    if (this.cur().type === 'name' && this.isOp(':=', 1)) {
      const start = this.cur().start
      const target: Name = { type: 'Name', start, end: this.cur().end, id: this.next().value }
      this.next() // :=
      const value = this.parseTest()
      return { type: 'NamedExpr', start, end: value.end, target, value }
    }
    return this.parseTest()
  }

  /** Ternary and lambda sit at the top of the expression grammar. */
  private parseTest(): Expr {
    if (this.isName('lambda')) return this.parseLambda()
    if (this.isName('yield')) return this.parseYield()
    const start = this.cur().start
    const body = this.parseOrTest()
    if (this.isName('if')) {
      this.next()
      const test = this.parseOrTest()
      if (!this.eatName('else')) {
        this.fail("expected 'else' in a conditional expression")
        return body
      }
      const orelse = this.parseTest()
      return { type: 'IfExp', start, end: orelse.end, test, body, orelse }
    }
    return body
  }

  private parseLambda(): Expr {
    const start = this.cur().start
    this.next()
    const params = this.parseParamList(':')
    this.expectOp(':')
    const body = this.parseTest()
    return { type: 'Lambda', start, end: body.end, params, body }
  }

  private parseYield(): Expr {
    const start = this.cur().start
    this.next()
    if (this.eatName('from')) {
      const value = this.parseTest()
      return { type: 'Yield', start, end: value.end, value, isFrom: true }
    }
    if (this.atStatementEnd() || this.isOp(')') || this.isOp(']') || this.isOp('}')) {
      return { type: 'Yield', start, end: this.peek(-1).end, isFrom: false }
    }
    const value = this.parseTestListStar()
    return { type: 'Yield', start, end: value.end, value, isFrom: false }
  }

  private parseOrTest(): Expr {
    const start = this.cur().start
    let left = this.parseAndTest()
    if (!this.isName('or')) return left
    const values: Expr[] = [left]
    while (this.eatName('or')) values.push(this.parseAndTest())
    left = { type: 'BoolOp', start, end: values[values.length - 1].end, op: 'or', values }
    return left
  }

  private parseAndTest(): Expr {
    const start = this.cur().start
    const left = this.parseNotTest()
    if (!this.isName('and')) return left
    const values: Expr[] = [left]
    while (this.eatName('and')) values.push(this.parseNotTest())
    return { type: 'BoolOp', start, end: values[values.length - 1].end, op: 'and', values }
  }

  private parseNotTest(): Expr {
    if (this.isName('not')) {
      const start = this.cur().start
      this.next()
      const operand = this.parseNotTest()
      return { type: 'UnaryOp', start, end: operand.end, op: 'not', operand }
    }
    return this.parseComparison()
  }

  private parseComparison(): Expr {
    const start = this.cur().start
    const left = this.parseBin(0)
    const ops: string[] = []
    const comparators: Expr[] = []
    let guard = 0
    for (;;) {
      let op: string | null = null
      if (this.cur().type === 'op' && COMPARE_OPS.has(this.cur().value)) {
        op = this.next().value
      } else if (this.isName('in')) {
        this.next()
        op = 'in'
      } else if (this.isName('not') && this.isName('in', 1)) {
        this.next()
        this.next()
        op = 'not in'
      } else if (this.isName('is')) {
        this.next()
        op = this.eatName('not') ? 'is not' : 'is'
      }
      if (!op || guard++ > 100) break
      ops.push(op)
      comparators.push(this.parseBin(0))
    }
    if (ops.length === 0) return left
    return { type: 'Compare', start, end: comparators[comparators.length - 1].end, left, ops, comparators }
  }

  /** Binary operators by precedence level; `**` and unary sit below. */
  private parseBin(level: number): Expr {
    if (level >= BIN_LEVELS.length) return this.parseFactor()
    const start = this.cur().start
    let left = this.parseBin(level + 1)
    let guard = 0
    while (this.cur().type === 'op' && BIN_LEVELS[level].includes(this.cur().value) && guard++ < 10000) {
      const opTok = this.next()
      const right = this.parseBin(level + 1)
      left = { type: 'BinOp', start, end: right.end, left, op: opTok.value, right, opStart: opTok.start }
    }
    return left
  }

  private parseFactor(): Expr {
    if (this.cur().type === 'op' && (this.cur().value === '-' || this.cur().value === '+' || this.cur().value === '~')) {
      const start = this.cur().start
      const op = this.next().value as '-' | '+' | '~'
      const operand = this.parseFactor()
      return { type: 'UnaryOp', start, end: operand.end, op, operand }
    }
    return this.parsePower()
  }

  private parsePower(): Expr {
    if (this.isName('await')) {
      const start = this.cur().start
      this.next()
      const value = this.parsePower()
      return { type: 'Await', start, end: value.end, value }
    }
    const start = this.cur().start
    const base = this.parseUnaryPostfix()
    if (this.isOp('**')) {
      const opTok = this.next()
      const right = this.parseFactor() // right-associative, binds unary tighter
      return { type: 'BinOp', start, end: right.end, left: base, op: '**', right, opStart: opTok.start }
    }
    return base
  }

  /** An atom followed by any number of `(...)`, `[...]` and `.name` trailers. */
  private parseUnaryPostfix(): Expr {
    const start = this.cur().start
    let node = this.parseAtom()
    let guard = 0
    for (;;) {
      if (guard++ > 10000) break
      if (this.isOp('(')) {
        this.next()
        const args: Expr[] = []
        const keywords: Keyword[] = []
        this.parseCallArgs(args, keywords)
        this.expectOp(')')
        node = { type: 'Call', start, end: this.peek(-1).end, func: node, args, keywords }
      } else if (this.isOp('[')) {
        this.next()
        const slice = this.parseSubscript()
        this.expectOp(']')
        node = { type: 'Subscript', start, end: this.peek(-1).end, value: node, slice }
      } else if (this.isOp('.') && this.peek(1).type === 'name') {
        this.next()
        const attrTok = this.next()
        node = {
          type: 'Attribute',
          start,
          end: attrTok.end,
          value: node,
          attr: attrTok.value,
          attrStart: attrTok.start
        }
      } else break
    }
    return node
  }

  /** Call arguments into `args`/`keywords`, stopping at the closing paren. */
  private parseCallArgs(args: Expr[], keywords: Keyword[]): void {
    let guard = 0
    while (!this.isOp(')') && this.cur().type !== 'eof' && guard++ < 10000) {
      const start = this.cur().start
      if (this.isOp('**')) {
        this.next()
        const value = this.parseTest()
        keywords.push({ type: 'Keyword', start, end: value.end, value })
      } else if (this.isOp('*')) {
        this.next()
        const value = this.parseTest()
        args.push({ type: 'Starred', start, end: value.end, value })
      } else if (this.cur().type === 'name' && this.isOp('=', 1) && !this.isOp('==', 1)) {
        const arg = this.next().value
        this.next() // =
        const value = this.parseTest()
        keywords.push({ type: 'Keyword', start, end: value.end, arg, value })
      } else {
        let value = this.parseNamedTest()
        // A generator expression as the sole argument: `sum(x for x in xs)`.
        if (this.isName('for') || (this.isName('async') && this.isName('for', 1))) {
          const generators = this.parseComprehensionClauses()
          value = {
            type: 'GeneratorExp',
            start,
            end: generators[generators.length - 1].end,
            elt: value,
            generators
          }
        }
        args.push(value)
      }
      if (!this.eatOp(',')) break
    }
  }

  /** The inside of `[...]`: an expression, a slice, or a tuple of either. */
  private parseSubscript(): Expr {
    const start = this.cur().start
    const parts: Expr[] = []
    let sawComma = false
    let guard = 0
    while (!this.isOp(']') && this.cur().type !== 'eof' && guard++ < 1000) {
      parts.push(this.parseSliceItem())
      if (this.eatOp(',')) sawComma = true
      else break
    }
    if (parts.length === 0) {
      this.fail('empty subscript')
      return { type: 'Name', start, end: start, id: '' }
    }
    if (parts.length === 1 && !sawComma) return parts[0]
    return { type: 'Tuple', start, end: parts[parts.length - 1].end, elts: parts, parenthesized: false }
  }

  private parseSliceItem(): Expr {
    const start = this.cur().start
    let lower: Expr | undefined
    if (!this.isOp(':')) {
      const first = this.parseStarOrTest()
      if (!this.isOp(':')) return first
      lower = first
    }
    this.expectOp(':')
    let upper: Expr | undefined
    if (!this.isOp(':') && !this.isOp(']') && !this.isOp(',')) upper = this.parseTest()
    let step: Expr | undefined
    if (this.eatOp(':')) {
      if (!this.isOp(']') && !this.isOp(',')) step = this.parseTest()
    }
    return { type: 'Slice', start, end: this.peek(-1).end, lower, upper, step }
  }

  /** `for x in xs if cond` clauses of a comprehension (at least one). */
  private parseComprehensionClauses(): Comprehension[] {
    const out: Comprehension[] = []
    let guard = 0
    while ((this.isName('for') || (this.isName('async') && this.isName('for', 1))) && guard++ < 100) {
      const start = this.cur().start
      const isAsync = this.eatName('async')
      this.next() // for
      const target = this.parseTargetList(['in'])
      if (!this.eatName('in')) this.fail("expected 'in' in a comprehension")
      const iter = this.parseOrTest()
      const ifs: Expr[] = []
      while (this.isName('if')) {
        this.next()
        ifs.push(this.parseOrTestNoCond())
      }
      out.push({ type: 'Comprehension', start, end: this.peek(-1).end, target, iter, ifs, isAsync })
    }
    if (out.length === 0) this.fail('expected a comprehension clause')
    return out
  }

  /** A comprehension's `if` guard cannot itself be a bare ternary. */
  private parseOrTestNoCond(): Expr {
    if (this.isName('lambda')) return this.parseLambda()
    return this.parseOrTest()
  }

  private parseAtom(): Expr {
    const t = this.cur()
    const start = t.start

    if (t.type === 'number') {
      this.next()
      return { type: 'Constant', start, end: t.end, kind: 'number', raw: t.value }
    }

    if (t.type === 'string') {
      // Adjacent string literals concatenate into one constant.
      let end = t.end
      let raw = t.value
      this.next()
      while (this.cur().type === 'string') {
        raw += this.src.slice(end, this.cur().end)
        end = this.cur().end
        this.next()
      }
      const m = /^([A-Za-z]*)['"]/.exec(t.value)
      return {
        type: 'Constant',
        start,
        end,
        kind: 'string',
        raw,
        prefix: (m?.[1] ?? '').toLowerCase()
      } as Constant
    }

    if (t.type === 'name') {
      if (t.value === 'True' || t.value === 'False') {
        this.next()
        return { type: 'Constant', start, end: t.end, kind: 'bool', raw: t.value }
      }
      if (t.value === 'None') {
        this.next()
        return { type: 'Constant', start, end: t.end, kind: 'none', raw: t.value }
      }
      if (t.value === 'lambda') return this.parseLambda()
      if (t.value === 'not') return this.parseNotTest()
      if (t.value === 'await') return this.parsePower()
      if (t.value === 'yield') return this.parseYield()
      this.next()
      return { type: 'Name', start, end: t.end, id: t.value }
    }

    if (t.type === 'op') {
      if (t.value === '...') {
        this.next()
        return { type: 'Constant', start, end: t.end, kind: 'ellipsis', raw: '...' }
      }
      if (t.value === '(') return this.parseParenAtom()
      if (t.value === '[') return this.parseListAtom()
      if (t.value === '{') return this.parseBraceAtom()
      if (t.value === '*') {
        this.next()
        const value = this.parseTest()
        return { type: 'Starred', start, end: value.end, value }
      }
    }

    this.fail('expected an expression')
    // A zero-width Name keeps the tree shaped while `errors` blocks refactoring.
    return { type: 'Name', start, end: start, id: '' }
  }

  private parseParenAtom(): Expr {
    const start = this.cur().start
    this.next() // (
    if (this.isOp(')')) {
      this.next()
      return { type: 'Tuple', start, end: this.peek(-1).end, elts: [], parenthesized: true }
    }
    const first = this.parseStarOrTest()
    if (this.isName('for') || (this.isName('async') && this.isName('for', 1))) {
      const generators = this.parseComprehensionClauses()
      this.expectOp(')')
      return { type: 'GeneratorExp', start, end: this.peek(-1).end, elt: first, generators }
    }
    if (this.isOp(',')) {
      const elts: Expr[] = [first]
      while (this.eatOp(',')) {
        if (this.isOp(')')) break
        elts.push(this.parseStarOrTest())
      }
      this.expectOp(')')
      return { type: 'Tuple', start, end: this.peek(-1).end, elts, parenthesized: true }
    }
    this.expectOp(')')
    return { type: 'Group', start, end: this.peek(-1).end, value: first }
  }

  private parseListAtom(): Expr {
    const start = this.cur().start
    this.next() // [
    if (this.isOp(']')) {
      this.next()
      return { type: 'List', start, end: this.peek(-1).end, elts: [] }
    }
    const first = this.parseStarOrTest()
    if (this.isName('for') || (this.isName('async') && this.isName('for', 1))) {
      const generators = this.parseComprehensionClauses()
      this.expectOp(']')
      return { type: 'ListComp', start, end: this.peek(-1).end, elt: first, generators }
    }
    const elts: Expr[] = [first]
    while (this.eatOp(',')) {
      if (this.isOp(']')) break
      elts.push(this.parseStarOrTest())
    }
    this.expectOp(']')
    return { type: 'List', start, end: this.peek(-1).end, elts }
  }

  private parseBraceAtom(): Expr {
    const start = this.cur().start
    this.next() // {
    if (this.isOp('}')) {
      this.next()
      return { type: 'Dict', start, end: this.peek(-1).end, keys: [], values: [] }
    }
    // `{**a}` is unambiguously a dict.
    if (this.isOp('**')) {
      const keys: (Expr | null)[] = []
      const values: Expr[] = []
      let guard = 0
      while (!this.isOp('}') && this.cur().type !== 'eof' && guard++ < 10000) {
        if (this.eatOp('**')) {
          keys.push(null)
          values.push(this.parseOrTest())
        } else {
          const k = this.parseTest()
          this.expectOp(':')
          keys.push(k)
          values.push(this.parseTest())
        }
        if (!this.eatOp(',')) break
      }
      this.expectOp('}')
      return { type: 'Dict', start, end: this.peek(-1).end, keys, values }
    }

    const first = this.parseStarOrTest()
    if (this.isOp(':')) {
      this.next()
      const firstVal = this.parseTest()
      if (this.isName('for') || (this.isName('async') && this.isName('for', 1))) {
        const generators = this.parseComprehensionClauses()
        this.expectOp('}')
        return {
          type: 'DictComp',
          start,
          end: this.peek(-1).end,
          key: first,
          elt: firstVal,
          generators
        }
      }
      const keys: (Expr | null)[] = [first]
      const values: Expr[] = [firstVal]
      let guard = 0
      while (this.eatOp(',') && guard++ < 10000) {
        if (this.isOp('}')) break
        if (this.eatOp('**')) {
          keys.push(null)
          values.push(this.parseOrTest())
          continue
        }
        const k = this.parseTest()
        this.expectOp(':')
        keys.push(k)
        values.push(this.parseTest())
      }
      this.expectOp('}')
      return { type: 'Dict', start, end: this.peek(-1).end, keys, values }
    }

    if (this.isName('for') || (this.isName('async') && this.isName('for', 1))) {
      const generators = this.parseComprehensionClauses()
      this.expectOp('}')
      return { type: 'SetComp', start, end: this.peek(-1).end, elt: first, generators }
    }

    const elts: Expr[] = [first]
    while (this.eatOp(',')) {
      if (this.isOp('}')) break
      elts.push(this.parseStarOrTest())
    }
    this.expectOp('}')
    return { type: 'Set', start, end: this.peek(-1).end, elts }
  }
}

/**
 * Parse `src` into a module. Never throws — a file with syntax the parser
 * cannot read comes back with a non-empty `errors`, which the engine treats as
 * "offer no refactorings for this file".
 */
export function parsePython(src: string): ParseResult {
  const lex = tokenize(src)
  const parser = new Parser(lex.tokens, src)
  const module = parser.parseModule()
  linkParents(module as AnyNode)
  return {
    module,
    comments: lex.comments,
    errors: [...lex.errors.map((e) => ({ ...e })), ...parser.errors]
  }
}
