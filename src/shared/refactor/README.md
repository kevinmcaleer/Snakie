# The refactoring engine — writing a rule

Epic [#634](https://github.com/kevinmcaleer/Snakie/issues/634). This directory is
the pure-TypeScript engine behind **right-click → Refactor…**: it parses Python,
detects code smells, and rewrites them as ranged text edits with a diff preview
and a one-key undo.

It lives in `src/shared/` (not the Python plugin host) so it works with **no
Python installed** and in **Snakie for Web** (#267), where there is no host at
all. Nothing here may import from `src/main/`, `src/renderer/`, Monaco, Electron
or Node — a rule must be testable with nothing but a source string.

## Layout

| File | What it is |
|---|---|
| `lexer.ts` | Python tokenizer — significant `NEWLINE`/`INDENT`/`DEDENT`, strings, comments |
| `parser.ts` | Recursive-descent parser → typed AST with exact source offsets |
| `ast.ts` | Node types, `walk`, `ancestors`, `enclosingFunction`, `blocksOf` |
| `scope.ts` | Binding analysis — `readBeforeWritten`, `isReadAfter`, `referencesTo`, `freshName` |
| `text.ts` | `TextEdit`, `applyEdits`, `dedent`, `detectIndentUnit`, `LineIndex` |
| `expr.ts` | `textOf`, `invertCondition`, `isPureExpression`, `isCallTo`, `literalNumber` |
| `engine.ts` | Context creation, `detectAll`, `applyOffer`, the §2.6 safety contract |
| `types.ts` | `RefactorRule`, `RefactorContext`, `RefactorMatch`, `defineRule` |
| `rules/` | One file per rule, plus `index.ts` — the catalogue |

## Why a hand-written parser and not tree-sitter

The epic originally proposed `web-tree-sitter` + a grammar wasm. Three things
killed it, all documented at the top of `parser.ts`: the Electron renderer's CSP
is `script-src 'self'` and Chrome gates WebAssembly on it, so a wasm parser means
weakening a deliberately locked-down renderer; ~650 KB of wasm is exactly the
Chromebook bundle worry the epic raised in §9; and an async, three-different-ways
-to-locate-the-wasm init is a lot of build config for something a synchronous
module does identically everywhere.

What §2.2 actually rejected was *indentation scanning*, on the grounds it could
never answer "is this variable used later?". `scope.ts` answers exactly that, so
Extract Function and Rename stay on the table.

## The contract

```ts
export const myRule = defineRule<MyMatchData>({
  id: 'kebab-case-id',              // also the fixture folder name
  title: 'Menu label',              // what the right-click menu says
  message: 'Problems-panel text',   // what the hint says
  catalogue: 33,                    // the number in epic §3
  category: 'micropython',
  kind: 'refactor',                 // or 'quickfix'
  severity: 'hint',                 // 'warning' for latent bugs
  helpArticle: 'refactor-my-rule',  // the "Why?" article id
  safe: true,                       // may "Tidy this file" batch it?
  detect(ctx) { /* pure */ },
  apply(match, ctx) { /* pure */ }
})
```

`detect` finds every occurrence in the file and returns matches carrying
whatever AST nodes `apply` will need in `data`. `apply` turns ONE match into
`TextEdit[]`, or returns `null` when it cannot prove the rewrite is safe.

Both are **pure and synchronous**. `detect` runs on every keystroke-ish
re-lint, so keep it cheap.

## The rules every rule obeys

These come from epic §2.6 and the golden suite enforces them:

1. **Never unparse the tree.** Compute edits from node offsets and splice
   source. `ctx.src.slice(node.start, node.end)` is your friend (`textOf`).
   Bytes outside your edit ranges must be byte-identical afterwards — that is
   what preserves the user's comments, blank lines and formatting for free.
2. **Match the file, don't impose your taste.** Use `ctx.indentUnit` and
   `ctx.eol`, never a hard-coded `'    '` or `'\n'`.
3. **Idempotent.** Applying twice must equal applying once — so `detect` must
   not fire on your own output.
4. **Round-trips.** The result must re-parse with zero errors. The engine
   double-checks and drops the offer if not, but get it right in the rule.
5. **Decline rather than guess.** If you cannot prove the rewrite preserves
   behaviour — a name would collide, an expression with side effects would be
   duplicated or dropped, control flow would change — return `null` from
   `apply`, or don't emit the match at all. A beginner who accepts a bad "fix"
   and breaks their robot will not trust the feature again. **False positives
   are worse than missed detections.**
6. **Don't duplicate impure expressions.** `isPureExpression()` before you use
   an expression's text twice. A call might touch hardware or cost milliseconds.

Board-gated rules (epic §3.7) add `requires: (caps) => caps.pio` and are offered
**only** when a board is connected and its probed capabilities pass. No board ⇒
no board hints, ever.

## Fixtures

```
test/fixtures/refactor/<rule-id>/
  before.py       # applying the rule everywhere must produce…
  after.py        # …exactly this, byte for byte
  before-2.py     # more pairs: a tab-indented file, a 2-space file, edge cases
  after-2.py
  no-match/*.py   # code that LOOKS like the smell but must NOT trigger
```

`test/refactorGolden.test.ts` discovers these automatically — you never edit the
test file. It also asserts the safety properties above for every pair.

The `no-match` corpus is not optional. It is where you encode the near-misses
you thought about: the `else` branch that makes the rewrite wrong, the loop
variable that IS used after all, the call that might have side effects.

## Running the tests

```bash
npx vitest run test/refactorGolden.test.ts test/refactorEngine.test.ts
npm run typecheck && npm run lint
```
