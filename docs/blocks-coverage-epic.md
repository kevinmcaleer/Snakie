# Blocks Coverage — Delivery Plan (Epic #1086)

> Teach the Blocks workspace to *read* the MicroPython people actually write.
> Epic #1007 shipped the canvas, the generator and a reader for the subset the
> generator emits; measured against a real corpus that reader renders 54.7% of
> lines as blocks and only 4.9% of files without a single grey fallback. This
> epic is about the other half.
> Owner: Kevin McAleer. Status: proposed. Epic #1086, with W0–W9 filed and
> linked as sub-issues #1087–#1096.

Nine workstreams (W1–W9), measured before and after. This document is the
evidence, the design decisions the epic turns on, the per-workstream plans and
the coverage ratchet that keeps the result from sliding back.

---

## 1. Overview & guiding principles

**What we're building.** Not new capability — new *recognition*. Every program
in scope already opens in Blocks today, because #1018's raw Python blocks are a
per-line fallback that cannot fail. What they open as is a wall of grey. This
epic converts grey into blocks, in the order the evidence says matters.

**The premise #1007 left behind.** Phase 5 of `blockly-epic.md` scoped the
reader as *"Python → blocks for the subset our own generator emits"*. That was
the right scope for a first pass and it is not the goal any more: a learner
opening a file from a tutorial, a GitHub repo or their own older project is the
common case, and none of those were written by our generator.

**The success test, stated once so every workstream can be measured against it.**
`PicoCrab2/crab.py` is 336 raw lines today — a real robot program of Kevin's,
written in ordinary MicroPython. It opens in Blocks as a grey wall. At the end of
this epic it opens as classes, methods, attribute assignments and calls, with
grey reserved for the genuinely exotic. Nothing about the file changes.

**Honest constraints, carried over from #1007 and still binding.**

- **Round-trip is the guarantee; recognition is a quality gradient on top of it.**
  Converting a program and generating it again must give back the same program.
  A workstream that improves recognition but breaks round-trip has made things
  worse, not better, and the gate in §2.3 exists to say so.
- **There is no AST, deliberately** (`blockly-epic.md` §5). A lexer and an
  indentation tree, identical on desktop and web. §4.1 checks every workstream
  here against that decision; all but two fit, and those two are not worth doing.
- **We generate the code we would teach** — but we *read* the code that exists.
  Reading is not an endorsement: a block that reads `self.x = 1` need not be a
  block we put in the toolbox for a ten-year-old.

---

## 2. The measurement

Everything in §3 is measured, not estimated. The method is written down here so
the numbers can be re-derived rather than trusted.

### 2.1 The corpus

`/Users/kev/MicroPython` is 12,738 `.py` files and 2.6M lines, and **95% of that
is not Kevin's code**: the MicroPython repo, `esp-idf`, Pimoroni libraries,
vendored subtrees, and — the big one — installed CPython virtualenvs inside
otherwise-ordinary project folders (`chip`, `chip_old`, `picogpt`,
`picotamachibi`, `picosmars2` are 4,200 files of `site-packages` between them).

Provenance was decided by `git remote origin`, not by directory name: Kevin's own
projects are git repos too, so a nested `.git` proves nothing. After filtering
vendored origins, vendored subtrees, `venv`/`site-packages`/`__pycache__`
segments and a list of well-known upstream single-file drivers (`ssd1306.py`,
`sdcard.py`, `mpu6050.py` …):

**688 files · 73 projects · 57,097 logical lines.**

That is the corpus every number below is against. It is worth saying plainly that
it is one person's corpus — see §9.1.

### 2.2 The harness

`pythonToBlocks()` is pure and Blockly-free by design, so it runs headless in
node over a file list with the full palette installed (`installCorePalette()` +
`installBlockDefinitions()`, exactly as `blocksRoundTripGate.test.ts` does).
Its `ConversionReport` already carries `recognised`, `raw` and `rawLines`, so
coverage is read off the real reader rather than modelled.

Each raw line is then bucketed by which construct it is. The bucketing is
heuristic — ordered, first-match-wins regexes over the line text — so bucket
*boundaries* are approximate even though the totals are exact. Treat the tier
subtotals in §3 as ±a few per cent.

### 2.3 The property: coverage is a ratchet

The harness becomes a repo test, and the number it prints may not go down. This
is the part that makes the epic durable: without it, the next reader change that
quietly demotes a construct to grey costs nothing and is found by a learner.

Three assertions, not one:

- **Statement coverage**: recognised/total over the corpus fixture,
  floor-asserted. This is what `ConversionReport` gives today.
- **Socket coverage**: how many value sockets hold a real block rather than a
  grey `snakie_python_value` / `snakie_python_call_value`. **New, and not
  optional** — see below.
- **Round-trip**: every file in the fixture still converts and regenerates to the
  same program, via the existing `verifyConversion` / `sameProgram` pair.

The last matters most. A workstream can always raise the first two by
recognising something badly; only round-trip stops it.

**Why socket coverage has to be its own number.** `rawValue()` never increments
`report.raw` — only `raw()` does (§4.2, which is also what makes Tier 1 cheap).
That asymmetry cuts both ways. `echo = Pin(0, Pin.IN)` reports
`recognised: 1, raw: 0` while rendering as *set echo to (grey blob)*, when the
palette has had `name pin 0 as echo for input` all along (#1097). Statement
coverage is blind to it, and would stay blind while W1, W2 and W10 fixed
thousands of lines of exactly that shape. A single number would make this epic
look like it had barely moved.

The corpus itself cannot go in the repo — it is 85,000 lines of someone's
personal projects. A **fixture of ~40 files, chosen to span the buckets**, goes
in `test/fixtures/coverage/`, with the full run kept as a manual script for when
the fixture and reality disagree.

---

## 3. The finding

**Baseline: 54.67% of logical lines recognised; 34 of 688 files (4.94%) render
with no grey at all; 25,880 raw lines.**

### 3.1 Tier 1 — the blocks already exist (W1, W2) → 68.8%

The largest gaps in the corpus need **no new block types**. `snakie_python_call`,
`snakie_python_call_value`, `snakie_python_attr_get` and `snakie_python_attr_set`
are in the Python drawer today, shipped by #1018 as escape hatches for humans to
drag. The reader never emits them.

Two specific bails in `lib/blocks/python-to-blocks.ts` are the whole story:

- `parseAtom` gives up on any name followed by `.`, `(` or `[` — so `self.angle`
  in an expression takes the entire enclosing statement to grey;
- `callStatement` only matches the built-in rule table or a hoisted object, and
  the built-in table is ten rules (`time.sleep` family, `print`, `len`, `abs`,
  `round` ×2). Only `hardware.ts` and `turtle.ts` add more through
  `registerCallRules`.

| Gap | Lines | % of raw | Projects | Target |
| --- | ---: | ---: | ---: | --- |
| method call on an object | 2,782 | 10.8% | **66** | `snakie_python_call` |
| assign to `self.x` | 2,649 | 10.2% | 45 | `snakie_python_attr_set` |
| call on `self.x.y()` | 1,478 | 5.7% | 40 | `snakie_python_call` |
| assign to `obj.attr` | 727 | 2.8% | 28 | `snakie_python_attr_set` |
| `.append()` | 403 | 1.6% | 28 | `snakie_list_append` |
| attribute read in an expression | 26 | 0.1% | 16 | `snakie_python_attr_get` |

**8,065 lines. 54.7% → 68.8%, with nothing added to the palette.**

`.append()` is worth calling out separately: `snakie_list_append` exists, sits in
the Lists drawer, and has no reader rule, because **only the hardware and turtle
palettes register any**. Lists, maths (`math_random_int`, `snakie_map_range`,
`snakie_math_min_max`), logic (`snakie_is_none`) and instruments all ship blocks
a learner can drag and the reader can never produce. That asymmetry is a bug in
its own right and W2 closes it for the whole palette, not just for lists.

### 3.2 Tier 2 — three cheap additions (W3, W4, W5) → 79.4%

| Gap | Lines | % of raw | Projects | Note |
| --- | ---: | ---: | ---: | --- |
| early/bare `return` | 2,359 | 9.1% | 57 | W3 |
| docstring / triple-quoted string | 2,174 | 8.4% | 48 | W4 |
| trailing comment on a statement | 1,532 | 5.9% | 55 | W5 |

**Trailing comments** are the cheapest line in the epic. Today a perfectly
ordinary statement goes grey *because it has a comment on the end of it* — the
reader declines rather than choose which half to keep, which was the right call
when no block could hold both. `x = 5  # how many times` is one of the most
common shapes in teaching code and it is 55 of 73 projects.

**`return`** is raw on purpose and the reason is recorded in the source: a
mid-function `return` became `procedures_ifreturn`, whose generated code is
`if <COND>: return <VALUE>`, and with nothing in COND the generator wrote
`if False:` — every early return in the program silently became dead code. The
fix is a real return block, not a re-run at the old one.

**Docstrings** are cheaper than they look. The lexer in `python-tokens.ts`
already folds a triple-quoted literal into one logical line and keeps its line
count honest, so a docstring arrives as a *single* unrecognised statement rather
than a run of them. What is missing is only a recogniser for a bare string
expression and a block that renders multi-line text without collapsing it.

### 3.3 Tier 3 — the class cluster and friends (W6, W7, W8) → 93.0%

**Classes are the single biggest theme in the corpus at 32.8% of all raw lines**
once W1's `self.` lines are counted with them. The reader's own placeholder text
admits it: `PYTHON_SUITE`'s field prompt is literally *"a Python block, e.g.
class Thing:"*.

| Gap | Lines | Projects | Workstream |
| --- | ---: | ---: | --- |
| nested `def` (a method) | 2,692 | 53 | W6 |
| `class` header | 604 | 46 | W6 |
| decorator (mostly `@property`) | 340 | 29 | W6 |
| `try` / `except` / `finally` | 1,271 | 40 | W7 |
| tuple / multiple assign (`a, b = …`) | 833 | 36 | W8 |
| nested or star imports | 467 | 32 | W8 |
| subscript assign (`a[i] = …`) | 390 | 27 | W8 |
| `raise` | 322 | 26 | W7 |
| augmented assign beyond `+=` | 323 | 31 | W8 |
| `in` / `not in` | 214 | 31 | W8 |
| `with` | 198 | 27 | W7 |
| `global` / `nonlocal` | 106 | 23 | W8 |

**7,760 lines. → 93.0%.**

### 3.4 Tier 4 — async (W9) → 94.0%

`await` (304 lines) and `async def` (266) reach 15 projects — real, and narrower
than everything above. `asyncio` + `uasyncio` together appear in 59 files across
~19 projects, so this is a genuine part of how Kevin writes, just not a
majority. It is scheduled last for that reason, not dismissed.

### 3.5 What we are deliberately not doing

- **`assert`** — 890 lines looks like a top-ten gap and is 8 projects, almost all
  `pytest` files. Breadth is the honest number; this is test code, not device
  code.
- **Chained comparisons** (`0 <= x < 10`) — **23 projects write them, and they
  cost 375 raw lines across only 6.** That gap is §4.2 at work: a chained
  comparison almost always sits in an `if`, where an unreadable condition sockets
  harmlessly and the `if` is still a real block. It is also the one construct
  here that genuinely wants a parser, and the existing refusal is correct and
  documented — folding left gives `(0 <= x) < 10`, which compares a bool against
  10. Leave it refused.
- **Comprehensions** — 26 projects write them; they cost **3** raw lines, for
  exactly the same reason.
- **`lambda` (10 projects), `yield` (6)** — genuinely rare in device code.
- **`match`/`case`** — **zero occurrences in all 73 projects.** Not rare: absent.
- **Everything below ~0.1% of raw lines.** The grey fallback is not a failure
  state; it is the guarantee. Some code should stay grey.

---

## 4. The design decisions

### 4.1 The no-AST decision holds, and this epic re-tests it

`blockly-epic.md` §5 ruled out all three AST candidates (no `ast` in the WASM
build; the CPython host is desktop-only; `tree-sitter-python` is ~1.2 MB of WASM)
and chose a lexer plus an indentation tree. Every workstream in §3 was checked
against that:

| Shape | Fits the lexer? |
| --- | --- |
| W1–W3, W5 — calls, attributes, `return`, trailing comments | Yes — token-level, the tokenizer already finds them |
| W4 — docstrings | Yes, with multi-line string runs in `logicalLines` |
| W6–W8 — `class`, `try`, `with`, tuple targets, `raise` | Yes — all are line-shaped headers or simple statements |
| W9 — `async`/`await` | Yes — a keyword prefix on shapes we already read |
| Chained comparisons, comprehensions | **No** — and §3.5 declines both |

So the decision stands. Nothing in this epic is an argument for a parser, which
is worth recording explicitly so the question is not re-opened every six months.

### 4.2 An unreadable argument does not cost the line

This is why Tier 1 is as cheap as it is, and it is not obvious.

`raw()` increments `report.raw` and pushes a line number. `rawValue()` does
neither — it hands back a `snakie_python_value` block holding the text. So a
statement that becomes a real block with an unreadable *expression* in one of its
sockets counts as recognised, and reads on the canvas as a real block with one
grey value in it.

Concretely: `self.display.text(f"{temp:.1f}", 0, 0)` needs W1 and nothing else.
The f-string sits in a grey socket and regenerates verbatim. **f-strings appear
in 44 projects and account for 5 raw lines**, because they are almost always
*inside* something else — which is the general shape of this whole epic. Fix the
statement and the expression stops mattering.

The corollary is a rule for every workstream: **recognise the statement, socket
the rest.** A workstream that waits until it can read the whole line will not
ship.

### 4.3 `self` is not a variable

A class method's `self` must not be declared as a Blockly workspace variable.
Blockly variables are global to the workspace and renameable from a dropdown; a
learner renaming `self` in one method would rename it in twelve, and the
generated code would be a class that no longer works. `self` is a field on the
method block, not a variable — the same call `modellableParams` already makes
about parameters it cannot model.

### 4.4 A class is a hat that holds a body

`procedures_defnoreturn` is a hat, and a hat cannot nest — which is exactly why
#1063 stopped hoisting methods out of classes and left them as a raw suite
instead. W6 therefore needs a class block with a **statement input**, and method
blocks that are ordinary stackable blocks rather than hats, so they can live in
it. This is the one place in the epic where the Blockly model, not the reader,
sets the shape.

### 4.5 Reading is not toolbox surface

Every block this epic adds is a block the reader can *emit*. Whether it also
appears in the toolbox for a learner to drag is a separate decision per block,
and mostly the answer is no: `class`, `try`, `global` and `async def` belong in
the reader's vocabulary and not in a ten-year-old's first drawer. The toolbox is
curated; the reader is comprehensive. Conflating the two would undo #1007's
framing.

---

## 5. Phased roadmap

**Phase A — the free coverage (W1, W2).** No new blocks; the reader learns to
emit blocks that already ship. Biggest single jump in the epic and the lowest
risk. W2 (palette-wide reader rules) is independent of W1 and can run in
parallel.

**Phase B — the cheap three (W3, W4, W5).** Independent of each other and of
Phase A. W5 (trailing comments) is the best first issue for anyone new to the
reader: small, self-contained, and 55 projects wide.

**Phase C — the class cluster (W6), then W7, W8.** W6 is the largest piece of
work in the epic and the one with a real Blockly design question in it (§4.4).
It should not start before the ratchet in §2.3 is in place, because it is the
workstream most able to break round-trip quietly.

**Phase D — async (W9).** Last, narrowest, and safe to drop if the epic runs
long.

The ratchet (§2.3) lands **before Phase A**, not with it. It is the only thing
that makes the rest of the epic measurable, and retrofitting it after three
workstreams have moved the number means never knowing which one moved it.

---

## 6. The workstreams

| | Issue | Workstream | New blocks? | Lines | Projects |
| --- | --- | --- | --- | ---: | ---: |
| **W0** | #1087 | Coverage ratchet + fixture corpus | none | — | — |
| **W1** | #1088 | Objects: method calls and attribute access | none | 7,662 | 66 |
| **W2** | #1089 | Palette-wide reader rules (lists, maths, logic, instruments) | none | 403+ | 28+ |
| **W10** | #1097 | Human-named pins → the `name pin` block | none | — | — |
| **W3** | #1090 | Early / bare `return` | 1 | 2,359 | 57 |
| **W4** | #1091 | Docstrings and multi-line strings | 1 | 2,174 | 48 |
| **W5** | #1092 | Trailing comments on a statement | 0–1 | 1,532 | 55 |
| **W6** | #1093 | Classes, methods, `@property` | 2–3 | 3,636 | 53 |
| **W7** | #1094 | `try`/`except`/`finally`, `raise`, `with` | 3–4 | 1,791 | 40 |
| **W8** | #1095 | Assignment and scope: tuple targets, subscripts, augmented, `global`, nested imports | 4–5 | 2,333 | 36 |
| **W9** | #1096 | `async def` / `await` | 2 | 570 | 15 |

**W1 — Objects.** Teach `parseAtom` to read `a.b` as `snakie_python_attr_get`
instead of bailing, `callStatement` to fall through to `snakie_python_call` when
no rule matches, and the assignment recogniser to accept a dotted target. Order
matters: the existing hoisted-object path (#1058) and the rule table must both
still win over the generic fallback, or `led_15.set(True)` regresses from a real
LED block to a generic call block. That regression is invisible to a coverage
number and is exactly what the round-trip half of the ratchet will not catch
either — it needs its own test.

**W2 — Palette-wide rules.** `registerCallRules` is already the extension point;
lists, maths, logic and instruments simply never call it. Mostly mechanical, and
it makes every future palette symmetrical by default.

**W5 — Trailing comments.** Either a comment field on every block, or a
line-comment block that attaches. The former is a wide change and the right one;
the latter is cheaper and will look wrong the first time someone drags it.

**W6 — Classes.** Class block with a statement input; method blocks that stack
inside it; `self` as a field (§4.3); `@property` as a modifier on the method
block rather than a block of its own. Inheritance (`class Foo(Bar):`) is 21
projects and should be a field on the class block from the start — retrofitting
it means a workspace migration.

---

## 7. Cross-cutting concerns

**The reader is on the critical path for opening a file.** It runs on every
Blocks open, so a workstream that makes it quadratic is a UI hang. The current
full-corpus run is 688 files in ~430 ms; that number goes in the ratchet too.

**Web parity.** Everything here is pure TypeScript in the reader and pure Blockly
in the palette, so desktop and web get it together. No workstream may reach for
the CPython plugin host (§4.1).

**Theming.** Any new block takes Soft Shell tokens in both `skeuomorph` and
`dark`, per epic #859's two-skin rule. New categories, if any, take their colour
from the existing tokens rather than a new hex.

**Versioning.** Each workstream that adds a visible block is a MINOR bump; the
reader-only ones (W1, W2) are visible capability too — a file that used to open
grey now opens as blocks — so they are MINOR as well. W0 and this document are
PATCH.

**File-format safety.** None of this changes the `snakie-blocks v1` comment
format. A file written by a newer Snakie still refuses to open on an older one
rather than dropping blocks, which is the existing rule and is unaffected.

---

## 8. Open questions for the owner

1. **Is 93% the target, or is "every file opens with no grey" the target?** They
   are different epics. The tiers above get to 93% of *lines*; getting most
   *files* fully grey-free is a longer tail, because one exotic line in a
   200-line file still shows. The current figure is 4.9% of files fully native
   and the tiers should take that to roughly half — but half is a guess until
   W0 can measure it, which is another argument for W0 first.
2. **Does the toolbox grow at all?** §4.5 argues most of these blocks are
   reader-only. If any of `class`, `try` or `with` should be draggable, that is a
   curriculum decision and it changes W6 and W7's scope.
3. **Whose corpus?** Everything here is measured against one person's 73
   projects. It is the right corpus for Snakie's author and probably a good proxy
   for the hobbyist MicroPython that learners will paste in — but the tier order
   would shift for, say, a classroom's worth of beginner files, which have almost
   no classes in them. Worth a second corpus before Phase C commits.
4. **Does W5 change the block format?** A comment field on every block is the
   right answer and touches the serialisation of every block type. Cheaper now
   than after three more workstreams have shipped.
